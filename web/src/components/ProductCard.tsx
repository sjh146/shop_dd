import { Link } from 'react-router-dom'
import type { Product } from '../lib/api'

export function formatKRW(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`
}

export function discountPct(product: Product): number | null {
  const sale = product.salePriceKrw
  const orig = product.originalPriceKrw
  if (!sale || !orig || orig <= 0 || sale <= 0 || sale >= orig) {
    return null
  }
  return Math.round((1 - sale / orig) * 100)
}

export function ProductCard({ product }: { product: Product }) {
  const pct = discountPct(product)
  const sale = product.salePriceKrw ?? 0
  const orig = product.originalPriceKrw ?? 0

  return (
    <Link to={`/products/${product.id}`} className="product-card">
      <div className="product-card__image-wrap">
        {product.imageUrl ? (
          <img
            className="product-card__image"
            src={product.imageUrl}
            alt={product.title}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget
              img.style.display = 'none'
              const fallback = img.nextElementSibling as HTMLElement | null
              if (fallback) fallback.style.display = 'flex'
            }}
          />
        ) : null}
        <div className="product-card__image-fallback" style={{ display: product.imageUrl ? 'none' : 'flex' }}>
          이미지 준비 중
        </div>
        {pct !== null ? <span className="discount-tag">-{pct}%</span> : null}
        {product.stock <= 0 ? <span className="soldout-tag">품절</span> : null}
      </div>
      <div className="product-card__body">
        <h3 className="product-card__title">{product.title}</h3>
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
      </div>
    </Link>
  )
}
