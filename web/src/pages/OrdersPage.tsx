import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOrders, type Order } from '../lib/api'
import { getToken } from '../lib/api'
import { formatKRW } from '../components/ProductCard'

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
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authed] = useState(Boolean(getToken()))

  useEffect(() => {
    if (!authed) {
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
  }, [authed])

  if (!authed) {
    return (
      <div className="container page">
        <h1 className="page-title">주문내역</h1>
        <div className="notice">
          주문 내역을 보려면 지갑 로그인이 필요해요. 상단의 지갑 연결 버튼을 눌러 주세요.
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
          <Link to="/" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
            상품 보러 가기
          </Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <Link to={`/orders/${o.id}`} className="order-row" key={o.id}>
              <div className="order-row__left">
                <span className="order-row__id">주문 #{o.id}</span>
                <span className="order-row__meta">
                  {new Date(o.createdAt).toLocaleDateString('ko-KR')}
                </span>
              </div>
              <div className="order-row__right">
                <span className="order-row__total">{formatKRW(o.totalKrw)}</span>
                <span className={`status-badge ${STATUS_CLASS[o.status] ?? 'status-badge--pending'}`}>
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
