import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProduct, type Product } from '../lib/api'
import { useCart } from '../lib/cart'
import { formatKRW, discountPct } from '../components/ProductCard'
import { JsonLd, usePageTitle } from '../lib/seo'

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
        if (!cancelled) setError('상품을 찾지 못했어요.')
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

  if (error || !product) {
    return (
      <div className="container page">
        <div className="notice notice--error">{error ?? '상품을 찾지 못했어요.'}</div>
      </div>
    )
  }

  const pct = discountPct(product)
  const sale = product.salePriceKrw ?? 0
  const orig = product.originalPriceKrw ?? 0

  const handleAdd = () => {
    addItem(product.id, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
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
                  price: sale,
                  priceCurrency: 'KRW',
                  availability:
                    product.stock > 0
                      ? 'https://schema.org/InStock'
                      : 'https://schema.org/OutOfStock'
                }
              }
            : {})
        }}
      />
      <div className="detail">
        <div className="detail__image-wrap">
          {product.imageUrl ? (
            <img
              className="detail__image"
              src={product.imageUrl}
              alt={product.title}
              onError={(e) => {
                const img = e.currentTarget
                img.style.display = 'none'
                const fallback = img.nextElementSibling as HTMLElement | null
                if (fallback) fallback.style.display = 'flex'
              }}
            />
          ) : null}
          <div
            className="product-card__image-fallback"
            style={{ display: product.imageUrl ? 'none' : 'flex' }}
          >
            이미지 준비 중
          </div>
        </div>

        <div className="detail__info">
          <h1 className="detail__title" data-testid="product-title">{product.title}</h1>
          {product.description ? (
            <p className="detail__desc">{product.description}</p>
          ) : null}

          <div
            className="price-block"
            data-testid="product-price"
            data-sale-price-krw={sale}
            data-stock={product.stock}
          >
            {pct !== null ? <span className="price-pct">{pct}%</span> : null}
            <span className="price-sale">{formatKRW(sale)}</span>
            {orig > 0 ? <span className="price-original">{formatKRW(orig)}</span> : null}
          </div>

          <p className="detail__stock" data-testid="product-stock">
            재고 {product.stock > 0 ? `${product.stock}개` : '품절'}
          </p>

          <div className="qty-row">
            <span className="qty-label">수량</span>
            <div className="qty-control">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="수량 줄이기"
                data-testid="qty-decrease"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                aria-label="수량 늘리기"
                data-testid="qty-increase"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-8">
            <button
              className="btn btn--primary btn--block"
              onClick={handleAdd}
              disabled={product.stock <= 0}
              data-testid="add-to-cart"
            >
              {added ? '장바구니에 담았어요' : '장바구니 담기'}
            </button>
          </div>

          <button type="button" className="text-link" onClick={() => navigate('/cart')}>
            장바구니로 이동
          </button>
        </div>
      </div>
    </div>
  )
}
