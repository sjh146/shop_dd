import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProducts,
  createOrder,
  verifyOrder,
  getNonce,
  verifySignature,
  setToken,
  type Product,
  type CreateOrderResponse
} from '../lib/api'
import { useCart } from '../lib/cart'
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
  BASE_SEPOLIA_CHAIN_ID
} from '../lib/wallet'

type Step = 'wallet' | 'auth' | 'order' | 'balance' | 'approve' | 'pay' | 'verify'

const FAUCET_AMOUNT = 100_000_000n // 100 mUSDC

export function CheckoutPage() {
  const navigate = useNavigate()
  const { items, clear } = useCart()

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
      if (!hasEthereum()) {
        setError('MetaMask 지갑이 필요해요. 브라우저에 MetaMask를 설치해 주세요.')
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
      await switchToBaseSepolia()
      setWrongNetwork(false)
      setStep('auth')
    } catch {
      setError('네트워크 전환에 실패했어요. MetaMask에서 Base Sepolia를 선택해 주세요.')
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
      setToken(authRes.token)
      setStep('order')
    } catch {
      setError('로그인 서명에 실패했어요. MetaMask에서 서명을 확인해 주세요.')
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
    } catch {
      setError('주문을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.')
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
    } catch {
      setError('USDC 승인에 실패했어요. MetaMask에서 승인 요청을 확인해 주세요.')
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
    } catch {
      setError('결제에 실패했어요. MetaMask에서 결제 요청을 확인해 주세요.')
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

  const usdcDisplay = orderResp
    ? (Number(orderResp.amount_usdc_micro) / 1_000_000).toFixed(6)
    : null

  return (
    <div className="container page">
      <h1 className="page-title">결제</h1>
      <p className="page-sub">결제 수단: USDC (Base Sepolia 테스트넷)</p>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="checkout-steps">
        {/* 1. Wallet connect */}
        <div className={`checkout-step ${step === 'wallet' ? 'checkout-step--active' : ''} ${address ? 'checkout-step--done' : ''}`}>
          <span className="checkout-step__num">1</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">지갑 연결</div>
            <div className="checkout-step__desc">
              {address ? `연결됨: ${address}` : 'MetaMask 지갑을 연결해 주세요.'}
            </div>
            {!address ? (
              <div className="checkout-step__action">
                <button className="btn btn--secondary" onClick={handleConnect} disabled={busy}>
                  지갑 연결
                </button>
              </div>
            ) : null}
            {wrongNetwork ? (
              <div className="checkout-step__action">
                <div className="notice">
                  Base Sepolia 네트워크가 필요해요. 네트워크를 전환해 주세요.
                </div>
                <button className="btn btn--secondary" onClick={handleSwitchNetwork} disabled={busy}>
                  Base Sepolia로 전환
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 2. Wallet auth */}
        <div className={`checkout-step ${step === 'auth' ? 'checkout-step--active' : ''}`}>
          <span className="checkout-step__num">2</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">로그인</div>
            <div className="checkout-step__desc">지갑 서명으로 로그인해 주세요.</div>
            {step === 'auth' ? (
              <div className="checkout-step__action">
                <button className="btn btn--secondary" onClick={handleAuth} disabled={busy}>
                  서명하고 로그인
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 3. Order create */}
        <div className={`checkout-step ${step === 'order' ? 'checkout-step--active' : ''}`}>
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
                <button className="btn btn--secondary" onClick={handleCreateOrder} disabled={busy}>
                  주문 생성
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 4. Balance check */}
        <div className={`checkout-step ${step === 'balance' ? 'checkout-step--active' : ''}`}>
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
                <button className="btn btn--secondary" onClick={handleCheckBalance} disabled={busy}>
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
                <button className="btn btn--secondary" onClick={handleFaucet} disabled={busy}>
                  테스트 USDC 받기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 5. Approve */}
        <div className={`checkout-step ${step === 'approve' ? 'checkout-step--active' : ''}`}>
          <span className="checkout-step__num">5</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">USDC 승인</div>
            <div className="checkout-step__desc">결제 컨트랙트에 USDC 사용을 승인해 주세요.</div>
            {step === 'approve' ? (
              <div className="checkout-step__action">
                <button className="btn btn--secondary" onClick={handleApprove} disabled={busy}>
                  승인하기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 6. Pay */}
        <div className={`checkout-step ${step === 'pay' ? 'checkout-step--active' : ''}`}>
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
                <button className="btn btn--primary" onClick={handlePay} disabled={busy}>
                  결제하기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 7. Verify */}
        <div className={`checkout-step ${step === 'verify' ? 'checkout-step--active' : ''}`}>
          <span className="checkout-step__num">7</span>
          <div className="checkout-step__body">
            <div className="checkout-step__title">결제 확인</div>
            <div className="checkout-step__desc">
              {txHash ? '결제가 전송됐어요. 확인을 진행해 주세요.' : '결제 확인을 진행해 주세요.'}
            </div>
            {step === 'verify' ? (
              <div className="checkout-step__action">
                <button className="btn btn--primary" onClick={handleVerify} disabled={busy}>
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
