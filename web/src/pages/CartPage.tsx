import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProducts, type Product } from '../lib/api'
import { useCart } from '../lib/cart'
import { formatKRW } from '../components/ProductCard'
import { usePageTitle } from '../lib/seo'

export function CartPage() {
  usePageTitle('장바구니')
  const { items, setQty, removeItem } = useCart()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Map<number, Product>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getProducts()
      .then((res) => {
        const map = new Map<number, Product>()
        for (const p of res.products) map.set(p.id, p)
        setProducts(map)
      })
      .catch(() => {
        // cart still renders with whatever we have
      })
      .finally(() => setLoading(false))
  }, [])

  const lines = items
    .map((item) => {
      const product = products.get(item.productId)
      if (!product) return null
      const price = product.salePriceKrw ?? 0
      return { ...item, product, price, lineTotal: price * item.qty }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)

  const total = lines.reduce((acc, l) => acc + l.lineTotal, 0)

  return (
    <div className="container page">
      <h1 className="page-title">장바구니</h1>
      <p className="page-sub">결제 수단: USDC (Base Sepolia 테스트넷)</p>

      {loading ? (
        <div className="loading">불러오는 중…</div>
      ) : lines.length === 0 ? (
        <div className="empty">
          장바구니가 비어 있어요.{' '}
          <Link to="/" className="text-link">
            상품 보러 가기
          </Link>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {lines.map((line) => (
              <div className="cart-item" key={line.productId} data-testid="cart-item" data-product-id={line.productId}>
                <div className="cart-item__thumb">
                  {line.product.imageUrl ? (
                    <img src={line.product.imageUrl} alt={line.product.title} loading="lazy" />
                  ) : null}
                </div>
                <div className="cart-item__info">
                  <div className="cart-item__title">{line.product.title}</div>
                  <div className="cart-item__unit">단가 {formatKRW(line.price)}</div>
                </div>
                <div className="cart-item__qty">
                  <div className="qty-control">
                    <button
                      type="button"
                      onClick={() => setQty(line.productId, line.qty - 1)}
                      aria-label="수량 줄이기"
                      data-testid="cart-qty-decrease"
                    >
                      −
                    </button>
                    <span>{line.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(line.productId, line.qty + 1)}
                      aria-label="수량 늘리기"
                      data-testid="cart-qty-increase"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="cart-item__total" data-testid="cart-line-total">{formatKRW(line.lineTotal)}</div>
                <button
                  type="button"
                  className="cart-item__remove"
                  onClick={() => removeItem(line.productId)}
                  data-testid="cart-remove"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>

          <div className="cart-summary" data-testid="cart-summary">
            <span className="cart-summary__label">합계</span>
            <span className="cart-summary__total" data-testid="cart-total">{formatKRW(total)}</span>
          </div>

          <div className="mt-24">
            <button
              className="btn btn--primary btn--block"
              onClick={() => navigate('/checkout')}
              data-testid="checkout-button"
            >
              결제하기
            </button>
          </div>
        </>
      )}
    </div>
  )
}
