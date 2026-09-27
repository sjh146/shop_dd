// API wrapper for the shop_dd backend. JWT is stored in localStorage.

const TOKEN_KEY = 'shop_dd_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * walletAddress claim from the stored JWT — a UX hint only (whether we can skip signing in
 * again). Actual signature trust lives on the server (AuthMiddleware).
 */
export function getTokenWallet(): string | null {
  const token = getToken()
  if (!token) return null
  try {
    const part = token.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { walletAddress?: string }
    return payload.walletAddress || null
  } catch {
    return null
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') {
        detail = body.error
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

// ── Types (mirror backend models.go) ──────────────────────────────────────

export interface Product {
  id: number
  sellingProductId: number
  title: string
  description: string
  imageUrl: string
  sourceUrl: string
  salePriceKrw?: number | null
  originalPriceKrw?: number | null
  marginPct?: string
  volume: number
  status: string
  stock: number
  syncedAt: string
  createdAt: string
  updatedAt: string
}

export interface OrderItem {
  id: number
  orderId: number
  productId: number
  title: string
  priceKrw: number
  qty: number
}

/** U.S. delivery address collected at checkout (operator ships the Korean order to it). */
export interface ShippingInfo {
  name: string
  phone: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
}

export interface Order {
  id: number
  userId: number
  walletAddress: string
  status: string
  totalKrw: number
  totalUsdcMicro: number
  gatewayOrderId?: string
  txHash?: string
  shipping?: ShippingInfo
  createdAt: string
  updatedAt: string
  items?: OrderItem[]
}

export interface NonceResponse {
  nonce: string
  message: string
  expiresIn: number
}

export interface AuthUser {
  id: number
  email: string
  name: string
  role: string
  isWalletUser: boolean
  createdAt: string
  updatedAt: string
}

export interface WalletAuthResponse {
  token: string
  walletAddress: string
  user: AuthUser
}

export interface CreateOrderResponse {
  order_id: number
  amount_usdc_micro: number
  gateway_order_id: string
  contract_address: string
  usdc_token: string
}

export interface VerifyOrderResponse {
  order: Order
  verifyError?: string
}

// ── Auth ──────────────────────────────────────────────────────────────────

export function getNonce(walletAddress: string): Promise<NonceResponse> {
  return request<NonceResponse>('/api/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress })
  })
}

export function verifySignature(
  walletAddress: string,
  signature: string,
  nonce: string
): Promise<WalletAuthResponse> {
  return request<WalletAuthResponse>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, signature, nonce })
  })
}

export function registerUser(
  email: string,
  password: string,
  name: string
): Promise<{ id: number; email: string; name: string }> {
  return request<{ id: number; email: string; name: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name })
  })
}

export function loginUser(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  return request<{ token: string; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
}

export function getMe(): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/api/auth/me')
}

// ── Products ──────────────────────────────────────────────────────────────

export function getProducts(): Promise<{ products: Product[] }> {
  return request<{ products: Product[] }>('/api/products')
}

export function getProduct(id: number): Promise<Product> {
  return request<Product>(`/api/products/${id}`)
}

// ── Orders (JWT) ──────────────────────────────────────────────────────────

/**
 * Creates an order. `shipping` is optional at the API level (older clients omit it) but the
 * checkout UI always sends it — it is how we know where to send the parcel.
 */
export function createOrder(
  items: { productId: number; qty: number }[],
  shipping?: ShippingInfo
): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(shipping ? { items, shipping } : { items })
  })
}

export function verifyOrder(id: number): Promise<VerifyOrderResponse> {
  return request<VerifyOrderResponse>(`/api/orders/${id}/verify`, {
    method: 'POST'
  })
}

export function cancelOrder(id: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/api/orders/${id}/cancel`, {
    method: 'POST'
  })
}

export function getOrders(): Promise<{ orders: Order[] }> {
  return request<{ orders: Order[] }>('/api/orders')
}

export function getOrder(id: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/api/orders/${id}`)
}
