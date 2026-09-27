import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOrders, type Order } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatUSD } from '../lib/format'
import { usePageTitle } from '../lib/seo'
import { PAYMENT_SUMMARY } from '../lib/config'

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting payment',
  registered: 'Payment initiated',
  paid: 'Paid',
  fulfilled: 'Preparing shipment',
  cancelled: 'Cancelled'
}

export const STATUS_CLASS: Record<string, string> = {
  pending: 'status-badge--pending',
  registered: 'status-badge--registered',
  paid: 'status-badge--paid',
  fulfilled: 'status-badge--fulfilled',
  cancelled: 'status-badge--cancelled'
}

export function OrdersPage() {
  usePageTitle('Order history')
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
        if (!cancelled) setError('We could not load your orders.')
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
        <h1 className="page-title">Order history</h1>
        <div className="loading">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="container page">
        <h1 className="page-title">Order history</h1>
        <div className="notice">
          Please{' '}
          <Link to="/login" className="text-link">
            log in
          </Link>{' '}
          to see your orders.
        </div>
      </div>
    )
  }

  return (
    <div className="container page">
      <h1 className="page-title">Order history</h1>
      <p className="page-sub">{PAYMENT_SUMMARY}</p>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : error ? (
        <div className="notice notice--error">{error}</div>
      ) : orders.length === 0 ? (
        <div className="empty">
          No orders yet.{' '}
          <Link to="/" className="text-link">
            Browse essentials
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
                <span className="order-row__id">Order #{o.id}</span>
                <span className="order-row__meta">
                  {new Date(o.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>
              </div>
              <div className="order-row__right">
                <span className="order-row__total">{formatUSD(o.totalKrw)}</span>
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
