import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProduct, type Product } from '../lib/api'
import { useCart } from '../lib/cart'
import { formatKRW, discountPct } from '../components/ProductCard'
import { isSafeExternalUrl } from '../lib/safeUrl'

export function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addItem } = useCart()

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)

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
    <div className="container page">
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
          {pct !== null ? <span className="discount-tag">-{pct}%</span> : null}
        </div>

        <div className="detail__info">
          <h1 className="detail__title">{product.title}</h1>
          {product.description ? (
            <p className="detail__desc">{product.description}</p>
          ) : null}

          <table className="price-table">
            <tbody>
              {orig > 0 ? (
                <tr>
                  <td>원가</td>
                  <td className="price-original">{formatKRW(orig)}</td>
                </tr>
              ) : null}
              <tr>
                <td>판매가</td>
                <td className="price-sale">{formatKRW(sale)}</td>
              </tr>
              {pct !== null ? (
                <tr>
                  <td>할인율</td>
                  <td className="price-discount">{pct}%</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <p className="detail__stock">
            재고 {product.stock > 0 ? `${product.stock}개` : '품절'}
          </p>

          <div className="qty-row">
            <span className="qty-label">수량</span>
            <div className="qty-control">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="수량 줄이기"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                aria-label="수량 늘리기"
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
            >
              {added ? '장바구니에 담았어요' : '장바구니 담기'}
            </button>
          </div>

          {isSafeExternalUrl(product.sourceUrl) ? (
            <a
              className="btn btn--ghost btn--block"
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              알리익스프레스에서 보기
            </a>
          ) : null}

          <button
            className="btn btn--secondary btn--block"
            onClick={() => navigate('/cart')}
          >
            장바구니로 이동
          </button>
        </div>
      </div>
    </div>
  )
}
