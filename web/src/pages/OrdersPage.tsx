import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOrders, type Order } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatKRW } from '../components/ProductCard'
import { usePageTitle } from '../lib/seo'

const STATUS_LABELS: Record<string, string> = {
  pending: '결제 대기',
  registered: '결제 등록',
  paid: '결제 완료',
  fulfilled: '배송 준비',
  cancelled: '취소됨'
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'status-badge--pending',
  registered: 'status-badge--registered',
  paid: 'status-badge--paid',
  fulfilled: 'status-badge--fulfilled',
  cancelled: 'status-badge--cancelled'
}

export function OrdersPage() {
  usePageTitle('주문내역')
  const { user, ready } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    getOrders()
      .then((res) => {
        if (!cancelled) setOrders(res.orders)
      })
      .catch(() => {
        if (!cancelled) setError('주문 내역을 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ready, user])

  if (!ready) {
    return (
      <div className="container page">
        <h1 className="page-title">주문내역</h1>
        <div className="loading">불러오는 중…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="container page">
        <h1 className="page-title">주문내역</h1>
        <div className="notice">
          주문 내역을 보려면 로그인이 필요해요.{' '}
          <Link to="/login" className="text-link">
            로그인
          </Link>{' '}
          후 다시 확인해 주세요.
        </div>
      </div>
    )
  }

  return (
    <div className="container page">
      <h1 className="page-title">주문내역</h1>
      <p className="page-sub">결제 수단: USDC (Base Sepolia 테스트넷)</p>

      {loading ? (
        <div className="loading">불러오는 중…</div>
      ) : error ? (
        <div className="notice notice--error">{error}</div>
      ) : orders.length === 0 ? (
        <div className="empty">
          주문 내역이 없어요.{' '}
          <Link to="/" className="text-link">
            상품 보러 가기
          </Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <Link
              to={`/orders/${o.id}`}
              className="order-row"
              key={o.id}
              data-testid="order-row"
              data-order-id={o.id}
              data-status={o.status}
            >
              <div className="order-row__left">
                <span className="order-row__id">주문 #{o.id}</span>
                <span className="order-row__meta">
                  {new Date(o.createdAt).toLocaleDateString('ko-KR')}
                </span>
              </div>
              <div className="order-row__right">
                <span className="order-row__total">{formatKRW(o.totalKrw)}</span>
                <span
                  className={`status-badge ${STATUS_CLASS[o.status] ?? 'status-badge--pending'}`}
                  data-testid="status-badge"
                  data-status={o.status}
                >
                  {STATUS_LABELS[o.status] ?? o.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
