import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProducts, type Product } from '../lib/api'
import { useCart } from '../lib/cart'
import { formatUSD } from '../lib/format'
import { usePageTitle } from '../lib/seo'
import { PAYMENT_SUMMARY, SHIPPING_COST_NOTE } from '../lib/config'

export function CartPage() {
  usePageTitle('Cart')
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
      <h1 className="page-title">Your cart</h1>
      <p className="page-sub">{PAYMENT_SUMMARY}</p>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : lines.length === 0 ? (
        <div className="empty">
          Your cart is empty.{' '}
          <Link to="/" className="text-link">
            Browse essentials
          </Link>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {lines.map((line) => (
              <div
                className="cart-item"
                key={line.productId}
                data-testid="cart-item"
                data-product-id={line.productId}
              >
                <div className="cart-item__thumb">
                  {line.product.imageUrl ? (
                    <img src={line.product.imageUrl} alt={line.product.title} loading="lazy" />
                  ) : null}
                </div>
                <div className="cart-item__info">
                  <div className="cart-item__title">{line.product.title}</div>
                  <div className="cart-item__unit">Each {formatUSD(line.price)}</div>
                </div>
                <div className="cart-item__qty">
                  <div className="qty-control">
                    <button
                      type="button"
                      onClick={() => setQty(line.productId, line.qty - 1)}
                      aria-label="Decrease quantity"
                      data-testid="cart-qty-decrease"
                    >
                      −
                    </button>
                    <span>{line.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(line.productId, line.qty + 1)}
                      aria-label="Increase quantity"
                      data-testid="cart-qty-increase"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="cart-item__total" data-testid="cart-line-total">
                  {formatUSD(line.lineTotal)}
                </div>
                <button
                  type="button"
                  className="cart-item__remove"
                  onClick={() => removeItem(line.productId)}
                  data-testid="cart-remove"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="summary-card" data-testid="cart-summary">
            <div className="summary-row">
              <span className="summary-row__label">Subtotal</span>
              <span className="summary-row__value">{formatUSD(total)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-row__label">International shipping</span>
              <span className="summary-row__value">Confirmed before dispatch</span>
            </div>
            <div className="summary-row summary-row--total">
              <span className="summary-row__label">Total due in USDC</span>
              <span className="summary-row__value" data-testid="cart-total">
                {formatUSD(total)}
              </span>
            </div>
            <p className="summary-note">{SHIPPING_COST_NOTE}</p>
          </div>

          <div className="mt-24">
            <button
              className="btn btn--primary btn--block"
              onClick={() => navigate('/checkout')}
              data-testid="checkout-button"
            >
              Checkout with MetaMask
            </button>
          </div>
        </>
      )}
    </div>
  )
}
