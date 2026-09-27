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
    <Link
      to={`/products/${product.id}`}
      className="product-card"
      data-testid="product-card"
      data-product-id={product.id}
      data-stock={product.stock}
    >
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
        {product.stock <= 0 ? <span className="soldout-tag" data-testid="soldout-tag">품절</span> : null}
      </div>
      <div className="product-card__body">
        <h3 className="product-card__title" data-testid="product-title">{product.title}</h3>
        <div className="product-card__price" data-testid="product-price" data-sale-price-krw={sale}>
          {pct !== null ? <span className="price-pct">{pct}%</span> : null}
          <span className="price-sale">{formatKRW(sale)}</span>
          {orig > 0 ? <span className="price-original">{formatKRW(orig)}</span> : null}
        </div>
      </div>
    </Link>
  )
}
