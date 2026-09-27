import { Link } from 'react-router-dom'
import type { Product } from '../lib/api'
import { discountPct, formatUSD, usdCentsFromKrw } from '../lib/format'

/** Shared product artwork with a graceful fallback when the image is missing. */
export function ProductImage({
  src,
  alt,
  className,
  fallbackClassName,
  eager
}: {
  src?: string
  alt: string
  className: string
  fallbackClassName: string
  eager?: boolean
}) {
  return (
    <>
      {src ? (
        <img
          className={className}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          onError={(e) => {
            const img = e.currentTarget
            img.style.display = 'none'
            const fallback = img.nextElementSibling as HTMLElement | null
            if (fallback) fallback.style.display = 'flex'
          }}
        />
      ) : null}
      <div className={fallbackClassName} style={{ display: src ? 'none' : 'flex' }}>
        Photo coming soon
      </div>
    </>
  )
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
        <ProductImage
          src={product.imageUrl}
          alt={product.title}
          className="product-card__image"
          fallbackClassName="product-card__image-fallback"
        />
        {product.stock <= 0 ? (
          <span className="soldout-tag" data-testid="soldout-tag">
            Sold out
          </span>
        ) : null}
      </div>
      <div className="product-card__body">
        <h3 className="product-card__title" data-testid="product-title">
          {product.title}
        </h3>
        <div
          className="product-card__price"
          data-testid="product-price"
          data-price-usd-cents={usdCentsFromKrw(sale)}
        >
          {pct !== null ? <span className="price-pct">{pct}% off</span> : null}
          <span className="price-sale">{formatUSD(sale)}</span>
          {orig > 0 ? <span className="price-original">{formatUSD(orig)}</span> : null}
        </div>
      </div>
    </Link>
  )
}
