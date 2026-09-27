import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProducts,
  createOrder,
  verifyOrder,
  getNonce,
  verifySignature,
  getTokenWallet,
  type Product,
  type CreateOrderResponse,
  type ShippingInfo
} from '../lib/api'
import { useCart } from '../lib/cart'
import { useAuth } from '../lib/auth'
import { formatUSD, formatUsdcMicro } from '../lib/format'
import {
  hasEthereum,
  connect,
  getChainId,
  switchToPaymentChain,
  signMessage,
  getUsdcBalance,
  approve,
  pay,
  faucet,
  CHAIN_ID,
  CHAIN_NAME,
  metamaskDeeplink,
  maybeOpenInMetaMaskApp,
  getExistingAccount,
  getAllowance
} from '../lib/wallet'
import { usePageTitle } from '../lib/seo'
import { PAYMENT_SUMMARY, SHIPPING_COST_NOTE, TESTNET, TESTNET_NOTICE } from '../lib/config'

type Step = 'wallet' | 'auth' | 'order' | 'balance' | 'approve' | 'pay' | 'verify'

const FAUCET_AMOUNT = 100_000_000n // 100 test USDC

const STEP_LABELS: Record<Step, string> = {
  wallet: 'Connect MetaMask',
  auth: 'Sign in',
  order: 'Create order',
  balance: 'Check balance',
  approve: 'Approve USDC',
  pay: 'Pay',
  verify: 'Confirm payment'
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY'
]

const EMPTY_SHIPPING: ShippingInfo = {
  name: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: ''
}

/** Client-side checks mirroring the server rules (server rejects invalid addresses with 400). */
function validateShipping(s: ShippingInfo): Partial<Record<keyof ShippingInfo, string>> {
  const errors: Partial<Record<keyof ShippingInfo, string>> = {}
  if (!s.name.trim()) errors.name = 'Enter the recipient name.'
  else if (s.name.trim().length > 120) errors.name = 'Name is too long.'
  if (!s.phone.trim()) errors.phone = 'Enter a phone number for the delivery.'
  else if (!/^[0-9+\-() ]{7,40}$/.test(s.phone.trim())) errors.phone = 'Use digits, spaces, +, - or ().'
  if (s.address1.trim().length < 3) errors.address1 = 'Enter the street address.'
  if ((s.address2 ?? '').trim().length > 200) errors.address2 = 'Address line 2 is too long.'
  if (!s.city.trim()) errors.city = 'Enter the city.'
  if (!/^[A-Z]{2}$/.test(s.state)) errors.state = 'Select a state.'
  if (!/^\d{5}(-\d{4})?$/.test(s.zip.trim())) errors.zip = 'Enter a 5-digit ZIP code.'
  return errors
}

/** Wallet / network errors → customer-facing copy */
function friendlyWalletError(e: unknown): string {
  const m = e instanceof Error ? e.message : ''
  if (/reject|denied|4001/i.test(m)) return 'The request was cancelled in MetaMask. Please try again.'
  if (/insufficient funds/i.test(m)) {
    return `You need a little ETH on ${CHAIN_NAME} to cover gas. Add gas funds and try again.`
  }
  if (/insufficient stock/i.test(m)) {
    return 'Not enough stock — an unpaid order may be holding it. Cancel that order in your order history to release the stock.'
  }
  if (/OrderNotRegistered/i.test(m)) {
    return 'This order is not registered on-chain yet (gateway registration pending or failed). Please try again in a moment.'
  }
  if (/OrderAlreadyPaid/i.test(m)) {
    return 'This order is already paid. Check the status in your order history.'
  }
  if (/NotOrderPayer/i.test(m)) {
    return 'This order was registered to a different wallet, so it cannot be paid from this one. Please create a new order.'
  }
  if (/AmountMismatch/i.test(m)) {
    return 'The payment amount does not match the recorded order. Please create a new order.'
  }
  if (/timeout|timed out/i.test(m)) {
    return 'Confirming the transaction is taking longer than usual. Check your order history in a moment.'
  }
  return m || 'Something went wrong during checkout. Please check the MetaMask prompt.'
}

function shippingPayload(s: ShippingInfo): ShippingInfo {
  return {
    name: s.name.trim(),
    phone: s.phone.trim(),
    address1: s.address1.trim(),
    address2: s.address2?.trim() ?? '',
    city: s.city.trim(),
    state: s.state,
    zip: s.zip.trim()
  }
}

export function CheckoutPage() {
  usePageTitle('Checkout')
  const navigate = useNavigate()
  const { items, clear } = useCart()
  const { adoptAuth } = useAuth()

  const [products, setProducts] = useState<Map<number, Product>>(new Map())
  const [loadingProducts, setLoadingProducts] = useState(true)

  const [shipping, setShipping] = useState<ShippingInfo>(EMPTY_SHIPPING)
  const [touched, setTouched] = useState(false)
  const shippingErrors = useMemo(() => validateShipping(shipping), [shipping])
  const shippingValid = Object.keys(shippingErrors).length === 0

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

  // Restore an already-authorised account silently (no popup) to keep one-click checkout quiet
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

  const totalUSD = lines.reduce((acc, l) => acc + l.lineTotal, 0)

  if (!loadingProducts && lines.length === 0) {
    return (
      <div className="container page">
        <div className="empty">Your cart is empty.</div>
      </div>
    )
  }

  const setField = (field: keyof ShippingInfo, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }))
  }

  const fieldError = (field: keyof ShippingInfo) =>
    touched ? shippingErrors[field] : undefined

  const handleConnect = async () => {
    setError(null)
    setBusy(true)
    try {
      if (maybeOpenInMetaMaskApp()) {
        setError('Opening the MetaMask app… If nothing happens, tap "Open in MetaMask" below.')
        return
      }
      if (!(await hasEthereum())) {
        setError(
          'No wallet found. On mobile use the "Open in MetaMask" button; on desktop install the MetaMask extension and try again.'
        )
        return
      }
      const addr = await connect()
      setAddress(addr)
      const chainId = await getChainId()
      if (chainId !== CHAIN_ID) {
        setWrongNetwork(true)
        setStep('wallet')
        return
      }
      setWrongNetwork(false)
      setStep('auth')
    } catch {
      setError('Could not connect the wallet. Please approve the request in MetaMask.')
    } finally {
      setBusy(false)
    }
  }

  const handleSwitchNetwork = async () => {
    setError(null)
    setBusy(true)
    try {
      const ok = await switchToPaymentChain()
      if (ok) {
        setWrongNetwork(false)
        setStep('auth')
      } else {
        setError(`If you switched to ${CHAIN_NAME} in the MetaMask app, tap "Check network" below.`)
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
      if (chainId === CHAIN_ID) {
        setWrongNetwork(false)
        setStep('auth')
      } else {
        setError(`Still not on ${CHAIN_NAME}. Please switch networks in the MetaMask app.`)
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
          : 'Signing in failed. Please approve the signature in MetaMask.'
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
        items.map((i) => ({ productId: i.productId, qty: i.qty })),
        shippingPayload(shipping)
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
      setError('Could not read your USDC balance. Please try again in a moment.')
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
      setError('Could not get test USDC. Please try again in a moment.')
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
        setError('The payment is not confirmed yet. Please check again in a moment.')
        return
      }
      clear()
      navigate(`/orders/${orderResp.order_id}`)
    } catch {
      setError('Could not confirm the payment. Please try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * One-click checkout — connect → sign in → create order → balance (auto faucet on testnet
   * when short) → approve (skipped when the allowance is sufficient) → pay → poll for
   * confirmation. The customer only taps the MetaMask prompts.
   */
  const autoPay = async () => {
    setTouched(true)
    if (!shippingValid) {
      setError('Please complete the shipping address before paying.')
      return
    }
    setError(null)
    setAutoRunning(true)
    setBusy(true)
    try {
      // ① Wallet connection (skipped when already connected)
      let addr = address
      if (!addr) {
        if (maybeOpenInMetaMaskApp()) {
          setError('Opening the MetaMask app… Once it opens, tap "Pay in one step" again.')
          return
        }
        if (!(await hasEthereum())) {
          setError(
            'No wallet found. On mobile open this page in MetaMask; on desktop install the extension and try again.'
          )
          return
        }
        addr = await connect()
        setAddress(addr)
        try {
          const chainId = await getChainId()
          if (chainId !== CHAIN_ID) await switchToPaymentChain()
        } catch {
          // Switching is re-prompted by the individual steps below
        }
      }
      setWrongNetwork(false)

      // ② Sign in — skipped when a token for the same wallet already exists
      setStep('auth')
      if (getTokenWallet()?.toLowerCase() !== addr.toLowerCase()) {
        const nonceRes = await getNonce(addr)
        const signature = await signMessage(nonceRes.message, addr as `0x${string}`)
        const authRes = await verifySignature(addr, signature, nonceRes.nonce)
        adoptAuth(authRes)
      }

      // ③ Create the order server-side (no wallet popup) — includes the shipping address
      setStep('order')
      let resp = orderResp
      if (!resp) {
        resp = await createOrder(
          items.map((i) => ({ productId: i.productId, qty: i.qty })),
          shippingPayload(shipping)
        )
        setOrderResp(resp)
      }

      // ④ Balance — auto-faucet on testnet (no popup, needs gas)
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
          // Auto-faucet failed — guided below
        }
        if (balance < needed) {
          setError(
            'Not enough USDC. Make sure the wallet holds a little testnet ETH for gas, then tap "Get test USDC".'
          )
          return
        }
        setInsufficient(false)
      }

      // ⑤ Approve — skipped when the allowance is already sufficient
      setStep('approve')
      const allowance = await getAllowance(
        resp.usdc_token as `0x${string}`,
        addr as `0x${string}`,
        resp.contract_address as `0x${string}`
      )
      if (allowance < needed) {
        await approve(resp.usdc_token, resp.contract_address, needed, addr as `0x${string}`)
      }

      // ⑥ Pay
      setStep('pay')
      const hash = await pay(
        resp.contract_address,
        resp.gateway_order_id,
        needed,
        addr as `0x${string}`
      )
      setTxHash(hash)

      // ⑦ Poll for confirmation (~45s)
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
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      setError('Confirming the payment is taking longer than usual. Check your order history.')
    } catch (e) {
      setError(friendlyWalletError(e))
    } finally {
      setBusy(false)
      setAutoRunning(false)
    }
  }

  const usdcDisplay = orderResp ? formatUsdcMicro(orderResp.amount_usdc_micro) : null

  return (
    <div className="container page" data-testid="checkout-page" data-payment-method="metamask">
      <h1 className="page-title">Checkout</h1>
      <p className="page-sub">{PAYMENT_SUMMARY}</p>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="checkout-layout">
        <div>
          <div className="checkout-card">
            <h2 className="checkout-card__title">Shipping address</h2>
            <p className="checkout-card__sub">
              U.S. address only. We use it to ship your order from Seoul.
            </p>
            <div className="form-grid">
              <label className="form-field form-grid--full">
                <span className="form-field__label">Full name</span>
                <input
                  className={`input${fieldError('name') ? ' input--invalid' : ''}`}
                  value={shipping.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Alex Kim"
                  autoComplete="name"
                  data-testid="ship-name-input"
                />
                {fieldError('name') ? (
                  <span className="form-field__error">{fieldError('name')}</span>
                ) : null}
              </label>

              <label className="form-field form-grid--full">
                <span className="form-field__label">Phone</span>
                <input
                  className={`input${fieldError('phone') ? ' input--invalid' : ''}`}
                  value={shipping.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="(213) 555-0134"
                  autoComplete="tel"
                  inputMode="tel"
                  data-testid="ship-phone-input"
                />
                {fieldError('phone') ? (
                  <span className="form-field__error">{fieldError('phone')}</span>
                ) : null}
              </label>

              <label className="form-field form-grid--full">
                <span className="form-field__label">Street address</span>
                <input
                  className={`input${fieldError('address1') ? ' input--invalid' : ''}`}
                  value={shipping.address1}
                  onChange={(e) => setField('address1', e.target.value)}
                  placeholder="1234 S Vermont Ave"
                  autoComplete="address-line1"
                  data-testid="ship-address1-input"
                />
                {fieldError('address1') ? (
                  <span className="form-field__error">{fieldError('address1')}</span>
                ) : null}
              </label>

              <label className="form-field form-grid--full">
                <span className="form-field__label">Apt, suite (optional)</span>
                <input
                  className="input"
                  value={shipping.address2}
                  onChange={(e) => setField('address2', e.target.value)}
                  placeholder="Apt 5B"
                  autoComplete="address-line2"
                  data-testid="ship-address2-input"
                />
              </label>

              <label className="form-field">
                <span className="form-field__label">City</span>
                <input
                  className={`input${fieldError('city') ? ' input--invalid' : ''}`}
                  value={shipping.city}
                  onChange={(e) => setField('city', e.target.value)}
                  placeholder="Los Angeles"
                  autoComplete="address-level2"
                  data-testid="ship-city-input"
                />
                {fieldError('city') ? (
                  <span className="form-field__error">{fieldError('city')}</span>
                ) : null}
              </label>

              <label className="form-field">
                <span className="form-field__label">State</span>
                <select
                  className={`select${fieldError('state') ? ' select--invalid' : ''}`}
                  value={shipping.state}
                  onChange={(e) => setField('state', e.target.value)}
                  autoComplete="address-level1"
                  data-testid="ship-state-select"
                >
                  <option value="">Select…</option>
                  {US_STATES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                {fieldError('state') ? (
                  <span className="form-field__error">{fieldError('state')}</span>
                ) : null}
              </label>

              <label className="form-field">
                <span className="form-field__label">ZIP code</span>
                <input
                  className={`input${fieldError('zip') ? ' input--invalid' : ''}`}
                  value={shipping.zip}
                  onChange={(e) => setField('zip', e.target.value)}
                  placeholder="90006"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  data-testid="ship-zip-input"
                />
                {fieldError('zip') ? (
                  <span className="form-field__error">{fieldError('zip')}</span>
                ) : null}
              </label>

              <div className="form-field">
                <span className="form-field__label">Country</span>
                <input className="input" value="United States" readOnly data-testid="ship-country" />
              </div>
            </div>
          </div>

          <div className="checkout-card">
            <h2 className="checkout-card__title">Payment</h2>
            <p className="checkout-card__sub">
              USDC on {CHAIN_NAME}, paid from your MetaMask wallet.
            </p>

            <div className="checkout-auto">
              <button
                className="btn btn--primary btn--block"
                onClick={autoPay}
                disabled={autoRunning || busy}
                data-testid="oneclick-pay"
              >
                {autoRunning ? `Working… (${STEP_LABELS[step]})` : 'Pay in one step'}
              </button>
              <p className="checkout-auto__hint">
                Connects your wallet, signs you in, creates the order, approves and pays USDC, then
                confirms it — you just tap the MetaMask prompts. Already connected and signed in?
                Even fewer prompts.
              </p>
            </div>

            <div className="checkout-steps" data-testid="checkout-steps" data-current-step={step}>
              <div
                className={`checkout-step ${step === 'wallet' ? 'checkout-step--active' : ''} ${address ? 'checkout-step--done' : ''}`}
                data-testid="checkout-step"
                data-step="wallet"
                data-state={address ? 'done' : step === 'wallet' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">1</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Connect MetaMask</div>
                  <div className="checkout-step__desc">
                    {address ? `Connected: ${address}` : 'Connect your MetaMask wallet.'}
                  </div>
                  {!address ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--secondary"
                        onClick={handleConnect}
                        disabled={busy}
                        data-testid="checkout-connect-wallet"
                      >
                        Connect MetaMask
                      </button>
                      <a
                        className="btn btn--ghost"
                        href={metamaskDeeplink()}
                        data-testid="open-metamask-app"
                      >
                        Open in MetaMask
                      </a>
                    </div>
                  ) : null}
                  {wrongNetwork ? (
                    <div className="checkout-step__action">
                      <div className="notice">
                        {CHAIN_NAME} is required. Please switch networks.
                      </div>
                      <button
                        className="btn btn--primary"
                        onClick={handleSwitchNetwork}
                        disabled={busy}
                      >
                        Switch to {CHAIN_NAME}
                      </button>
                      <button
                        className="btn btn--ghost"
                        onClick={handleRecheckNetwork}
                        disabled={busy}
                      >
                        Check network
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'auth' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="auth"
                data-state={step === 'auth' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">2</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Sign in</div>
                  <div className="checkout-step__desc">Sign a message to sign in.</div>
                  {step === 'auth' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleAuth}
                        disabled={busy}
                        data-testid="sign-login"
                      >
                        Sign and sign in
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'order' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="order"
                data-state={step === 'order' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">3</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Create order</div>
                  <div className="checkout-step__desc">
                    {orderResp
                      ? `Order #${orderResp.order_id} · ${formatUSD(totalUSD)} · ${usdcDisplay}`
                      : 'Create the order with your shipping address.'}
                  </div>
                  {step === 'order' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleCreateOrder}
                        disabled={busy}
                        data-testid="create-order"
                      >
                        Create order
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'balance' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="balance"
                data-state={step === 'balance' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">4</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Check USDC balance</div>
                  <div className="checkout-step__desc">
                    {usdcBalance !== null
                      ? `Wallet balance: ${formatUsdcMicro(usdcBalance.toString())}`
                      : 'Check the USDC balance in your wallet.'}
                  </div>
                  {step === 'balance' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleCheckBalance}
                        disabled={busy}
                        data-testid="check-balance"
                      >
                        Check balance
                      </button>
                    </div>
                  ) : null}
                  {insufficient ? (
                    <div className="notice mt-8">
                      You need more USDC for this order.
                      {TESTNET ? ' Get test USDC with the button below.' : ''}
                    </div>
                  ) : null}
                  {insufficient && TESTNET ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleFaucet}
                        disabled={busy}
                        data-testid="request-test-usdc"
                      >
                        Get test USDC
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'approve' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="approve"
                data-state={step === 'approve' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">5</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Approve USDC</div>
                  <div className="checkout-step__desc">
                    Allow the payment contract to spend your USDC.
                  </div>
                  {step === 'approve' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleApprove}
                        disabled={busy}
                        data-testid="approve-usdc"
                      >
                        Approve
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'pay' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="pay"
                data-state={step === 'pay' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">6</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Pay</div>
                  <div className="checkout-step__desc">
                    {orderResp
                      ? `Paying ${formatUSD(totalUSD)} (${usdcDisplay}).`
                      : 'Send the USDC payment.'}
                  </div>
                  {step === 'pay' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handlePay}
                        disabled={busy}
                        data-testid="pay-order"
                      >
                        Pay now
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`checkout-step ${step === 'verify' ? 'checkout-step--active' : ''}`}
                data-testid="checkout-step"
                data-step="verify"
                data-state={step === 'verify' ? 'active' : 'pending'}
              >
                <span className="checkout-step__num">7</span>
                <div className="checkout-step__body">
                  <div className="checkout-step__title">Confirm payment</div>
                  <div className="checkout-step__desc">
                    {txHash
                      ? 'Payment sent. Waiting for confirmation.'
                      : 'Confirm the payment to finish your order.'}
                  </div>
                  {step === 'verify' ? (
                    <div className="checkout-step__action">
                      <button
                        className="btn btn--primary"
                        onClick={handleVerify}
                        disabled={busy}
                        data-testid="verify-payment"
                      >
                        Confirm payment
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <p className="summary-note">
              {TESTNET ? `${TESTNET_NOTICE} ` : ''}
              {SHIPPING_COST_NOTE}
            </p>
          </div>
        </div>

        <aside className="summary-card" data-testid="checkout-summary">
          <div className="summary-row">
            <span className="summary-row__label">Items</span>
            <span className="summary-row__value">{lines.length}</span>
          </div>
          <div className="line-list">
            {lines.map((l) => (
              <div className="line-list__row" key={l.productId}>
                <span className="line-list__name">
                  {l.product.title} × {l.qty}
                </span>
                <span>{formatUSD(l.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div className="summary-row summary-row--total">
            <span className="summary-row__label">Total in USDC</span>
            <span className="summary-row__value" data-testid="checkout-total" data-total-usd={totalUSD}>
              {formatUSD(totalUSD)}
            </span>
          </div>
          <div className="line-list">
            <div className="line-list__row">
              <span className="line-list__name">Ship to</span>
              <span>
                {shipping.city && shipping.state
                  ? `${shipping.city}, ${shipping.state} ${shipping.zip}`
                  : '—'}
              </span>
            </div>
          </div>
          <p className="summary-note">
            {formatUSD(totalUSD)} is charged in USDC on {CHAIN_NAME} — MetaMask shows the exact
            amount before you confirm, and nothing is sent until you approve it.
          </p>
        </aside>
      </div>
    </div>
  )
}
