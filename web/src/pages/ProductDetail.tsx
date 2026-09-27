import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getProduct, type Product } from '../lib/api'
import { useCart } from '../lib/cart'
import { ProductImage } from '../components/ProductCard'
import { discountPct, formatUSD, usdCentsFromKrw } from '../lib/format'
import { JsonLd, usePageTitle } from '../lib/seo'
import { CHAIN_NAME, SHIPPING_COST_NOTE, TESTNET } from '../lib/config'

export function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addItem } = useCart()

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  usePageTitle(product?.title)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getProduct(Number(id))
      .then((p) => {
        if (!cancelled) setProduct(p)
      })
      .catch(() => {
        if (!cancelled) setError('We could not find that product.')
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

  if (error || !product) {
    return (
      <div className="container page">
        <div className="notice notice--error">{error ?? 'We could not find that product.'}</div>
        <Link to="/" className="text-link">
          Back to shop
        </Link>
      </div>
    )
  }

  const pct = discountPct(product)
  const sale = product.salePriceKrw ?? 0
  const orig = product.originalPriceKrw ?? 0
  const usdCents = usdCentsFromKrw(sale)

  const handleAdd = () => {
    addItem(product.id, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  const handleBuyNow = () => {
    addItem(product.id, qty)
    navigate('/checkout')
  }

  return (
    <div className="container page" data-testid="product-detail" data-product-id={product.id}>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.title,
          ...(product.description ? { description: product.description } : {}),
          ...(product.imageUrl ? { image: product.imageUrl } : {}),
          sku: String(product.id),
          url: window.location.href,
          ...(sale > 0
            ? {
                offers: {
                  '@type': 'Offer',
                  price: (usdCents / 100).toFixed(2),
                  priceCurrency: 'USD',
                  availability:
                    product.stock > 0
                      ? 'https://schema.org/InStock'
                      : 'https://schema.org/OutOfStock'
                }
              }
            : {})
        }}
      />

      <Link to="/" className="breadcrumb" data-testid="back-to-shop">
        ← Back to shop
      </Link>

      <div className="detail">
        <div className="detail__image-wrap">
          <ProductImage
            src={product.imageUrl}
            alt={product.title}
            className="detail__image"
            fallbackClassName="product-card__image-fallback"
            eager
          />
        </div>

        <div className="detail__info">
          <h1 className="detail__title" data-testid="product-title">
            {product.title}
          </h1>
          {product.description ? <p className="detail__desc">{product.description}</p> : null}

          <div
            className="price-block"
            data-testid="product-price"
            data-price-usd-cents={usdCents}
            data-stock={product.stock}
          >
            {pct !== null ? <span className="price-pct">{pct}% off</span> : null}
            <span className="price-sale">{formatUSD(sale)}</span>
            {orig > 0 ? <span className="price-original">{formatUSD(orig)}</span> : null}
          </div>
          {sale > 0 ? (
            <span className="price-usdc" data-testid="price-usdc">
              Settled as {(usdCents / 100).toFixed(2)} USDC on {CHAIN_NAME}
              {TESTNET ? ' (test network)' : ''} at checkout.
            </span>
          ) : null}

          <p
            className={`detail__stock${product.stock > 0 ? '' : ' detail__stock--out'}`}
            data-testid="product-stock"
          >
            {product.stock > 0
              ? `In stock — ships from Seoul (${product.stock} available)`
              : 'Sold out'}
          </p>

          <div className="qty-row">
            <span className="qty-label">Quantity</span>
            <div className="qty-control">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                data-testid="qty-decrease"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                aria-label="Increase quantity"
                data-testid="qty-increase"
              >
                +
              </button>
            </div>
          </div>

          <div className="buy-row">
            <button
              className="btn btn--primary"
              onClick={handleAdd}
              disabled={product.stock <= 0}
              data-testid="add-to-cart"
            >
              {added ? 'Added to cart ✓' : 'Add to cart'}
            </button>
            <button
              className="btn btn--secondary"
              onClick={handleBuyNow}
              disabled={product.stock <= 0}
              data-testid="buy-now"
            >
              Buy now
            </button>
          </div>

          <ul className="info-list" style={{ marginTop: 4 }}>
            <li>{SHIPPING_COST_NOTE}</li>
            <li>Delivery usually takes 7–14 business days.</li>
            <li>Paid in USDC from your MetaMask wallet — no card needed.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
