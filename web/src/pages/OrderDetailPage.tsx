import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getOrder, cancelOrder, type Order } from '../lib/api'
import { formatUSD, formatUsdcMicro } from '../lib/format'
import { usePageTitle } from '../lib/seo'
import { CHAIN_NAME, EXPLORER_URL, SHIPPING_DETAIL } from '../lib/config'
import { STATUS_CLASS, STATUS_LABELS } from './OrdersPage'

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMsg, setCancelMsg] = useState<string | null>(null)
  usePageTitle(order ? `Order #${order.id}` : undefined)

  async function handleCancel() {
    if (!order) return
    if (
      !window.confirm(
        'Cancel this order? The reserved stock goes back on the shelf and any USDC payment stays unspent.'
      )
    )
      return
    setCancelling(true)
    setCancelMsg(null)
    try {
      const res = await cancelOrder(order.id)
      setOrder(res.order)
    } catch (e) {
      setCancelMsg(e instanceof Error ? e.message : 'We could not cancel this order.')
    } finally {
      setCancelling(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getOrder(Number(id))
      .then((res) => {
        if (!cancelled) setOrder(res.order)
      })
      .catch(() => {
        if (!cancelled) setError('We could not find that order.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="container page">
        <div className="loading">Loading…</div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="container page">
        <div className="notice notice--error">{error ?? 'We could not find that order.'}</div>
        <Link to="/orders" className="text-link">
          Back to order history
        </Link>
      </div>
    )
  }

  return (
    <div className="container page">
      <h1 className="page-title">Order #{order.id}</h1>
      <p className="page-sub">
        <Link to="/orders" className="text-link">
          ← Order history
        </Link>
      </p>

      <div
        className="order-detail"
        data-testid="order-detail"
        data-order-id={order.id}
        data-status={order.status}
      >
        <div className="order-detail__section">
          <h3>Status</h3>
          <span className={`status-badge ${STATUS_CLASS[order.status] ?? 'status-badge--pending'}`}>
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
          {(order.status === 'pending' || order.status === 'registered') && (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn-cancel"
                onClick={handleCancel}
                disabled={cancelling}
                data-testid="cancel-order"
              >
                {cancelling ? 'Cancelling…' : 'Cancel order'}
              </button>
              {cancelMsg ? (
                <p style={{ color: 'var(--danger, #a33)', fontSize: 13.5, marginTop: 8 }}>
                  {cancelMsg}
                </p>
              ) : null}
            </div>
          )}
          {order.status === 'paid' && (
            <p className="notice notice--success mt-16">
              Payment received. We are placing the Korean order and will ship it to your U.S.
              address.
            </p>
          )}
        </div>

        <div className="order-detail__section">
          <h3>Payment</h3>
          <dl className="order-detail__meta">
            <dt>Amount</dt>
            <dd data-testid="order-total">
              {formatUSD(order.totalKrw)} · {formatUsdcMicro(order.totalUsdcMicro)}
            </dd>
            <dt>Network</dt>
            <dd>{CHAIN_NAME}</dd>
            {order.txHash ? (
              <>
                <dt>Transaction</dt>
                <dd>
                  <a
                    className="tx-link"
                    href={`${EXPLORER_URL}/tx/${order.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {order.txHash}
                  </a>
                </dd>
              </>
            ) : null}
            <dt>Placed</dt>
            <dd>
              {new Date(order.createdAt).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short'
              })}
            </dd>
            <dt>Wallet</dt>
            <dd>{order.walletAddress}</dd>
          </dl>
        </div>

        <div className="order-detail__section">
          <h3>Shipping address</h3>
          {order.shipping ? (
            <div className="address-block" data-testid="order-shipping">
              <div>{order.shipping.name}</div>
              <div>{order.shipping.phone}</div>
              <div>
                {order.shipping.address1}
                {order.shipping.address2 ? <>, {order.shipping.address2}</> : null}
              </div>
              <div>
                {order.shipping.city}, {order.shipping.state} {order.shipping.zip}
              </div>
              <div>United States</div>
            </div>
          ) : (
            <p className="site-footer__line">
              No address on this order (created before addresses were collected).
            </p>
          )}
          <p className="summary-note mt-8">{SHIPPING_DETAIL}</p>
        </div>

        <div className="order-detail__section">
          <h3>Items</h3>
          {order.items && order.items.length > 0 ? (
            <table className="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.qty}</td>
                    <td>{formatUSD(item.priceKrw)}</td>
                    <td>{formatUSD(item.priceKrw * item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="site-footer__line">No line items on this order.</p>
          )}
        </div>
      </div>
    </div>
  )
}
