import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getOrder, type Order } from '../lib/api'
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

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getOrder(Number(id))
      .then((res) => {
        if (!cancelled) setOrder(res.order)
      })
      .catch(() => {
        if (!cancelled) setError('주문을 찾지 못했어요.')
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
        <div className="loading">불러오는 중…</div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="container page">
        <div className="notice notice--error">{error ?? '주문을 찾지 못했어요.'}</div>
      </div>
    )
  }

  const usdcDisplay = (Number(order.totalUsdcMicro) / 1_000_000).toFixed(6)

  return (
    <div className="container page">
      <h1 className="page-title">주문 #{order.id}</h1>
      <p className="page-sub">
        <Link to="/orders" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          주문내역으로
        </Link>
      </p>

      <div className="order-detail">
        <div className="order-detail__section">
          <h3>주문 상태</h3>
          <span className={`status-badge ${STATUS_CLASS[order.status] ?? 'status-badge--pending'}`}>
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
        </div>

        <div className="order-detail__section">
          <h3>결제 정보</h3>
          <dl className="order-detail__meta">
            <dt>결제 금액</dt>
            <dd>
              {formatKRW(order.totalKrw)} ({usdcDisplay} USDC)
            </dd>
            {order.txHash ? (
              <>
                <dt>거래 해시</dt>
                <dd>
                  <a
                    className="tx-link"
                    href={`https://sepolia.basescan.org/tx/${order.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {order.txHash}
                  </a>
                </dd>
              </>
            ) : null}
            <dt>주문 일시</dt>
            <dd>{new Date(order.createdAt).toLocaleString('ko-KR')}</dd>
          </dl>
        </div>

        <div className="order-detail__section">
          <h3>상품</h3>
          {order.items && order.items.length > 0 ? (
            <table className="items-table">
              <thead>
                <tr>
                  <th>상품</th>
                  <th>수량</th>
                  <th>가격</th>
                  <th>합계</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.qty}</td>
                    <td>{formatKRW(item.priceKrw)}</td>
                    <td>{formatKRW(item.priceKrw * item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>상품 정보가 없어요.</p>
          )}
        </div>

        <div className="notice notice--quiet">
          알리익스프레스 직배송, 평균 2~3주. 테스트넷 상점입니다 — 실결제 아님.
        </div>
      </div>
    </div>
  )
}
