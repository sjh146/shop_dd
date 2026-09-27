import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProducts,
  createOrder,
  verifyOrder,
  getNonce,
  verifySignature,
  getTokenWallet,
  type Product,
  type CreateOrderResponse
} from '../lib/api'
import { useCart } from '../lib/cart'
import { useAuth } from '../lib/auth'
import { formatKRW } from '../components/ProductCard'
import {
  hasEthereum,
  connect,
  getChainId,
  switchToBaseSepolia,
  signMessage,
  getUsdcBalance,
  approve,
  pay,
  faucet,
  BASE_SEPOLIA_CHAIN_ID,
  metamaskDeeplink,
  maybeOpenInMetaMaskApp,
  getExistingAccount,
  getAllowance
} from '../lib/wallet'
import { usePageTitle } from '../lib/seo'

type Step = 'wallet' | 'auth' | 'order' | 'balance' | 'approve' | 'pay' | 'verify'

const FAUCET_AMOUNT = 100_000_000n // 100 mUSDC

const STEP_LABELS: Record<Step, string> = {
  wallet: 'MetaMask 연결',
  auth: '로그인 서명',
  order: '주문 생성',
  balance: '잔액 확인',
  approve: 'USDC 승인',
  pay: '결제',
  verify: '결제 확인'
}

/** 지갑/네트워크 에러를 사용자 문구로 변환 */
function friendlyWalletError(e: unknown): string {
  const m = e instanceof Error ? e.message : ''
  if (/reject|denied|4001/i.test(m)) return 'MetaMask에서 요청을 취소했어요. 다시 시도해 주세요.'
  if (/insufficient funds/i.test(m)) {
    return '가스용 Sepolia ETH가 부족해요. 테스트 ETH를 받은 뒤 다시 시도해 주세요.'
  }
  if (/insufficient stock/i.test(m)) {
    return '상품 재고가 부족해요 — 미결제 주문이 재고를 잡고 있으면, 주문내역에서 그 주문을 취소하면 재고가 풀려요.'
  }
  if (/OrderNotRegistered/i.test(m)) {
    return '이 주문은 아직 온체인 등록 전이라 결제할 수 없어요 (게이트웨이 등록 대기/실패). 잠시 후 다시 시도해 주세요.'
  }
  if (/OrderAlreadyPaid/i.test(m)) {
    return '이 주문은 이미 결제된 주문이에요. 주문내역에서 상태를 확인해 주세요.'
  }
  if (/NotOrderPayer/i.test(m)) {
    return '이 주문은 다른 지갑 주소로 등록돼 있어 결제할 수 없어요. 주문을 새로 만들어 주세요.'
  }
  if (/AmountMismatch/i.test(m)) {
    return '결제 금액이 주문 기록과 달라요. 주문을 새로 만들어 주세요.'
  }
  if (/timeout|timed out/i.test(m)) {
    return '트랜잭션 확인이 지연되고 있어요. 잠시 후 주문내역에서 상태를 확인해 주세요.'
  }
  return m || '결제 진행 중 문제가 발생했어요. MetaMask 확인창을 눌러주세요.'
}

export function CheckoutPage() {
  usePageTitle('결제')
  const navigate = useNavigate()
  const { items, clear } = useCart()
  const { adoptAuth } = useAuth()

  const [products, setProducts] = useState<Map<number, Product>>(new Map())
  const [loadingProducts, setLoadingProducts] = useState(true)

  const [address, setAddress] = useState<string | null>(null)
  const [wrongNetwork, setWrongNetwork] = useState(false)
  const [step, setStep] = useState<Step>('wallet')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [orderResp, setOrderResp] = useState<CreateOrderResponse | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [insufficient, setInsufficient] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)

  // 이미 승인된 지갑이면 조용히 복원 (팝업 없음) — 원클릭 결제의 확인창을 줄인다
  useEffect(() => {
    let cancelled = false
    getExistingAccount().then((acc) => {
      if (cancelled || !acc) return
      setAddress(acc)
      setStep(getTokenWallet()?.toLowerCase() === acc.toLowerCase() ? 'order' : 'auth')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    getProducts()
      .then((res) => {
        const map = new Map<number, Product>()
        for (const p of res.products) map.set(p.id, p)
        setProducts(map)
      })
      .catch(() => {
        // ignore — cart lines may still render
      })
      .finally(() => setLoadingProducts(false))
  }, [])

  const lines = items
    .map((item) => {
      const product = products.get(item.productId)
      if (!product) return null
      const price = product.salePriceKrw ?? 0
      return { ...item, product, price, lineTotal: price * item.qty }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)

  const totalKRW = lines.reduce((acc, l) => acc + l.lineTotal, 0)

  if (!loadingProducts && lines.length === 0) {
    return (
      <div className="container page">
        <div className="empty">장바구니가 비어 있어요.</div>
      </div>
    )
  }

  const handleConnect = async () => {
    setError(null)
    setBusy(true)
    try {
      // 모바일 브라우저 + 지갑 없음 → MetaMask 앱 내장 브라우저로 자동 이동
      if (maybeOpenInMetaMaskApp()) {
        setError('MetaMask 앱으로 이동 중… 앱이 열리지 않으면 아래 "MetaMask 앱에서 열기"를 눌러주세요.')
        return
      }
      if (!(await hasEthereum())) {
        setError('지갑을 찾지 못했어요. 모바일은 아래 "MetaMask 앱에서 열기" 버튼으로, 데스크톱은 MetaMask 확장 설치 후 다시 시도해 주세요.')
        return
      }
      const addr = await connect()
      setAddress(addr)
      const chainId = await getChainId()
      if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
        setWrongNetwork(true)
        setStep('wallet')
        return
      }
      setWrongNetwork(false)
      setStep('auth')
    } catch {
      setError('지갑 연결에 실패했어요. MetaMask에서 요청을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const handleSwitchNetwork = async () => {
    setError(null)
    setBusy(true)
    try {
      // 내성적 전환: MetaMask 앱에서 승인/전환됐으면 여기서 실제 체인을 확인해 넘어감
      const ok = await switchToBaseSepolia()
      if (ok) {
        setWrongNetwork(false)
        setStep('auth')
      } else {
        setError('MetaMask 앱에서 Base Sepolia로 전환됐다면, 아래 [전환 완료 확인] 버튼을 눌러주세요.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRecheckNetwork = async () => {
    setError(null)
    setBusy(true)
    try {
      const chainId = await getChainId().catch(() => 0)
      if (chainId === BASE_SEPOLIA_CHAIN_ID) {
        setWrongNetwork(false)
        setStep('auth')
      } else {
        setError('아직 Base Sepolia가 아니에요. MetaMask 앱에서 네트워크를 Base Sepolia로 바꿔주세요.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAuth = async () => {
    if (!address) return
    setError(null)
    setBusy(true)
    try {
      const nonceRes = await getNonce(address)
      const signature = await signMessage(nonceRes.message, address as `0x${string}`)
      const authRes = await verifySignature(address, signature, nonceRes.nonce)
      adoptAuth(authRes)
      setStep('order')
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : '로그인 서명에 실패했어요. MetaMask에서 서명을 확인해 주세요.'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleCreateOrder = async () => {
    setError(null)
    setBusy(true)
    try {
      const resp = await createOrder(
        items.map((i) => ({ productId: i.productId, qty: i.qty }))
      )
      setOrderResp(resp)
      setStep('balance')
    } catch (e) {
      setError(friendlyWalletError(e))
    } finally {
      setBusy(false)
    }
  }

  const handleCheckBalance = async () => {
    if (!address || !orderResp) return
    setError(null)
    setBusy(true)
    try {
      const balance = await getUsdcBalance(orderResp.usdc_token, address as `0x${string}`)
      setUsdcBalance(balance)
      const needed = BigInt(orderResp.amount_usdc_micro)
      if (balance < needed) {
        setInsufficient(true)
        setStep('balance')
      } else {
        setInsufficient(false)
        setStep('approve')
      }
    } catch {
      setError('USDC 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const handleFaucet = async () => {
    if (!address || !orderResp) return
    setError(null)
    setBusy(true)
    try {
      await faucet(orderResp.usdc_token, address as `0x${string}`, FAUCET_AMOUNT)
      const balance = await getUsdcBalance(orderResp.usdc_token, address as `0x${string}`)
      setUsdcBalance(balance)
      const needed = BigInt(orderResp.amount_usdc_micro)
      if (balance >= needed) {
        setInsufficient(false)
        setStep('approve')
      }
    } catch {
      setError('테스트 USDC를 받지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = async () => {
    if (!address || !orderResp) return
    setError(null)
    setBusy(true)
    try {
      await approve(
        orderResp.usdc_token,
        orderResp.contract_address,
        BigInt(orderResp.amount_usdc_micro),
        address as `0x${string}`
      )
      setStep('pay')
    } catch (e) {
      setError(friendlyWalletError(e))
    } finally {
      setBusy(false)
    }
  }

  const handlePay = async () => {
    if (!address || !orderResp) return
    setError(null)
    setBusy(true)
    try {
      const hash = await pay(
        orderResp.contract_address,
        orderResp.gateway_order_id,
        BigInt(orderResp.amount_usdc_micro),
        address as `0x${string}`
      )
      setTxHash(hash)
      setStep('verify')
    } catch (e) {
      setError(friendlyWalletError(e))
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async () => {
    if (!orderResp) return
    setError(null)
    setBusy(true)
    try {
      const res = await verifyOrder(orderResp.order_id)
      if (res.verifyError) {
        setError('결제 확인이 아직 안 됐어요. 잠시 후 다시 확인해 주세요.')
        return
      }
      clear()
      navigate(`/orders/${orderResp.order_id}`)
    } catch {
      setError('결제 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 한 번에 결제 — 지갑 연결 → 로그인 → 주문 생성 → 잔액(부족 시 자동 faucet)
   * → 승인(allowance 충분하면 생략) → 결제 → 확인 폴링까지 자동 진행.
   * 사용자는 MetaMask 확인창만 누르면 된다.
   */
  const autoPay = async () => {
    setError(null)
    setAutoRunning(true)
    setBusy(true)
    try {
      // ① 지갑 연결 (이미 연결돼 있으면 생략)
      let addr = address
      if (!addr) {
        if (maybeOpenInMetaMaskApp()) {
          setError('MetaMask 앱으로 이동 중… 앱이 열리면 "한 번에 결제하기"를 다시 눌러주세요.')
          return
        }
        if (!(await hasEthereum())) {
          setError('지갑을 찾지 못했어요. 모바일은 MetaMask 앱에서, 데스크톱은 확장 설치 후 다시 시도해 주세요.')
          return
        }
        addr = await connect()
        setAddress(addr)
        try {
          const chainId = await getChainId()
          if (chainId !== BASE_SEPOLIA_CHAIN_ID) await switchToBaseSepolia()
        } catch {
          // 전환은 아래 단계에서 실패 시 개별 안내
        }
      }
      setWrongNetwork(false)

      // ② 로그인 — 같은 지갑의 토큰이 이미 있으면 서명 생략
      setStep('auth')
      if (getTokenWallet()?.toLowerCase() !== addr.toLowerCase()) {
        const nonceRes = await getNonce(addr)
        const signature = await signMessage(nonceRes.message, addr as `0x${string}`)
        const authRes = await verifySignature(addr, signature, nonceRes.nonce)
        adoptAuth(authRes)
      }

      // ③ 주문 생성 (서버사이드 — 지갑 팝업 없음)
      setStep('order')
      let resp = orderResp
      if (!resp) {
        resp = await createOrder(items.map((i) => ({ productId: i.productId, qty: i.qty })))
        setOrderResp(resp)
      }

      // ④ 잔액 확인 — 부족하면 테스트넷 자동 faucet (팝업 없음, 가스 필요)
      setStep('balance')
      const needed = BigInt(resp.amount_usdc_micro)
      let balance = await getUsdcBalance(resp.usdc_token, addr as `0x${string}`)
      setUsdcBalance(balance)
      if (balance < needed) {
        setInsufficient(true)
        try {
          await faucet(resp.usdc_token, addr as `0x${string}`, FAUCET_AMOUNT)
          balance = await getUsdcBalance(resp.usdc_token, addr as `0x${string}`)
          setUsdcBalance(balance)
        } catch {
          // 자동 faucet 실패 — 아래 안내로
        }
        if (balance < needed) {
          setError('테스트 USDC가 부족해요. 지갑에 가스용 Sepolia ETH가 있는지 확인한 뒤 테스트 USDC 받기를 눌러주세요.')
          return
        }
        setInsufficient(false)
      }

      // ⑤ 승인 — allowance가 이미 충분하면 MetaMask 팝업 생략
      setStep('approve')
      const allowance = await getAllowance(
        resp.usdc_token as `0x${string}`,
        addr as `0x${string}`,
        resp.contract_address as `0x${string}`
      )
      if (allowance < needed) {
        await approve(resp.usdc_token, resp.contract_address, needed, addr as `0x${string}`)
      }

      // ⑥ 결제
      setStep('pay')
      const hash = await pay(
        resp.contract_address,
        resp.gateway_order_id,
        needed,
        addr as `0x${string}`
      )
      setTxHash(hash)

      // ⑦ 결제 확인 자동 폴링 (최대 ~45초)
      setStep('verify')
      for (let i = 0; i < 15; i++) {
        try {
          const res = await verifyOrder(resp.order_id)
          if (!res.verifyError) {
            clear()
            navigate(`/orders/${resp.order_id}`)
            return
          }
        } catch {
          // 일시 오류 — 계속 폴링
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      setError('결제 확인이 지연되고 있어요. 주문내역에서 상태를 확인해 주세요.')
    } catch (e) {
      setError(friendlyWalletError(e))
    } finally {
      setBusy(false)
      setAutoRunning(false)
    }
  }

  const usdcDisplay = orderResp
    ? (Number(orderResp.amount_usdc_micro) / 1_000_000).toFixed(6)
    : null

  return (
    <div className="container page" data-testid="checkout-page" data-payment-method="metamask">
      <h1 className="page-title">결제</h1>
      <p className="page-sub">결제 수단: MetaMask 지갑 + USDC (Base Sepolia 테스트넷)</p>

      {error ? <div className="notice notice--error" role="alert">{error}</div> : null}

      <div className="checkout-auto">
        <button
          className="btn btn--primary btn--block"
          onClick={autoPay}
          disabled={autoRunning || busy}
          data-testid="oneclick-pay"
        >
          {autoRunning ? `진행 중… (${STEP_LABELS[step]})` : '한 번에 결제하기'}
        </button>
        <p className="checkout-auto__hint">
          지갑 연결 → 로그인 서명 → 주문 생성 → USDC 승인 → 결제 → 확인을 자동으로 진행해요.
          MetaMask 확인창만 눌러주세요. (이미 연결·로그인돼 있으면 확인창이 더 줄어들어요)
        </p>
      </div>

      <div className="checkout-steps" data-testid="checkout-steps" data-current-step={step}>
        {/* 1. Wallet connect */}
        <div
          className={`checkout-step ${step === 'wallet' ? 'checkout-step--active' : ''} ${address ? 'checkout-step--done' : ''}`}
          data-testid="checkout-step"
          data-step="wallet"
          data-state={address ? 'done' : step === 'wallet' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">1</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">MetaMask 연결</div>
            <div className="checkout-step__desc">
              {address ? `연결됨: ${address}` : 'MetaMask 지갑을 연결해 주세요.'}
            </div>
            {!address ? (
              <div className="checkout-step__action">
                <button
                  className="btn btn--secondary"
                  onClick={handleConnect}
                  disabled={busy}
                  data-testid="checkout-connect-wallet"
                >
                  MetaMask 연결
                </button>
                <a
                  className="btn btn--ghost"
                  href={metamaskDeeplink()}
                  style={{ marginLeft: 8 }}
                  data-testid="open-metamask-app"
                >
                  MetaMask 앱에서 열기
                </a>
              </div>
            ) : null}
            {wrongNetwork ? (
              <div className="checkout-step__action">
                <div className="notice">
                  Base Sepolia 네트워크가 필요해요. 네트워크를 전환해 주세요.
                </div>
                <button className="btn btn--primary" onClick={handleSwitchNetwork} disabled={busy}>
                  Base Sepolia로 전환
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={handleRecheckNetwork}
                  disabled={busy}
                  style={{ marginLeft: 8 }}
                >
                  전환 완료 확인
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 2. Wallet auth */}
        <div
          className={`checkout-step ${step === 'auth' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="auth"
          data-state={step === 'auth' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">2</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">로그인</div>
            <div className="checkout-step__desc">지갑 서명으로 로그인해 주세요.</div>
            {step === 'auth' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleAuth} disabled={busy} data-testid="sign-login">
                  서명하고 로그인
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 3. Order create */}
        <div
          className={`checkout-step ${step === 'order' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="order"
          data-state={step === 'order' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">3</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">주문 생성</div>
            <div className="checkout-step__desc">
              {orderResp
                ? `주문 #${orderResp.order_id} · ${formatKRW(totalKRW)} · ${usdcDisplay} USDC`
                : '주문을 생성해 주세요.'}
            </div>
            {step === 'order' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleCreateOrder} disabled={busy} data-testid="create-order">
                  주문 생성
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 4. Balance check */}
        <div
          className={`checkout-step ${step === 'balance' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="balance"
          data-state={step === 'balance' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">4</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">USDC 잔액 확인</div>
            <div className="checkout-step__desc">
              {usdcBalance !== null
                ? `보유: ${(Number(usdcBalance) / 1_000_000).toFixed(6)} USDC`
                : '결제에 필요한 USDC 잔액을 확인해 주세요.'}
            </div>
            {step === 'balance' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleCheckBalance} disabled={busy} data-testid="check-balance">
                  잔액 확인
                </button>
              </div>
            ) : null}
            {insufficient ? (
              <div className="notice mt-8">
                테스트 USDC가 필요해요. 아래 버튼으로 테스트 USDC를 받아 주세요.
              </div>
            ) : null}
            {insufficient ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleFaucet} disabled={busy} data-testid="request-test-usdc">
                  테스트 USDC 받기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 5. Approve */}
        <div
          className={`checkout-step ${step === 'approve' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="approve"
          data-state={step === 'approve' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">5</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">USDC 승인</div>
            <div className="checkout-step__desc">결제 컨트랙트에 USDC 사용을 승인해 주세요.</div>
            {step === 'approve' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleApprove} disabled={busy} data-testid="approve-usdc">
                  승인하기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 6. Pay */}
        <div
          className={`checkout-step ${step === 'pay' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="pay"
          data-state={step === 'pay' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">6</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">결제</div>
            <div className="checkout-step__desc">
              {orderResp
                ? `${formatKRW(totalKRW)} (${usdcDisplay} USDC)를 결제합니다.`
                : '결제를 진행해 주세요.'}
            </div>
            {step === 'pay' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handlePay} disabled={busy} data-testid="pay-order">
                  결제하기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 7. Verify */}
        <div
          className={`checkout-step ${step === 'verify' ? 'checkout-step--active' : ''}`}
          data-testid="checkout-step"
          data-step="verify"
          data-state={step === 'verify' ? 'active' : 'pending'}
        >
          <span className="checkout-step__num">7</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">결제 확인</div>
            <div className="checkout-step__desc">
              {txHash ? '결제가 전송됐어요. 확인을 진행해 주세요.' : '결제 확인을 진행해 주세요.'}
            </div>
            {step === 'verify' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleVerify} disabled={busy} data-testid="verify-payment">
                  결제 확인
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="notice notice--quiet">
        테스트넷 상점입니다 — 실결제 아님. USDC 결제는 수수료가 없어요.
      </div>
    </div>
  )
}
