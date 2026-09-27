import { useEffect, useState } from 'react'
import { getProducts, type Product } from '../lib/api'
import { ProductCard } from '../components/ProductCard'
import { JsonLd, usePageTitle } from '../lib/seo'

export function ProductList() {
  usePageTitle()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getProducts()
      .then((res) => {
        if (!cancelled) setProducts(res.products)
      })
      .catch(() => {
        if (!cancelled) setError('상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="container page">
      <h1 className="page-title">상품</h1>
      <p className="page-sub">알리익스프레스 직배송 상품을 MetaMask 지갑의 USDC로 결제하는 테스트넷 쇼핑몰이에요. 실제 돈은 오가지 않아요.</p>
      <div
        className="pay-strip"
        data-testid="payment-notice"
        data-payment-method="metamask"
        data-payment-token="USDC"
        data-payment-network="Base Sepolia"
        data-payment-chain-id="84532"
        data-payment-mode="testnet"
      >
        <span className="pay-strip__badge">MetaMask 전용 결제</span>
        <span>USDC · Base Sepolia 테스트넷 — MetaMask 지갑으로만 결제할 수 있어요.</span>
      </div>

      {loading ? (
        <div className="loading">불러오는 중…</div>
      ) : error ? (
        <div className="notice notice--error">{error}</div>
      ) : products.length === 0 ? (
        <div className="empty">상품이 없어요.</div>
      ) : (
        <>
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: '사이버몰 상품 목록',
              numberOfItems: products.length,
              itemListElement: products.map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                item: {
                  '@type': 'Product',
                  name: p.title,
                  ...(p.imageUrl ? { image: p.imageUrl } : {}),
                  ...(p.description ? { description: p.description } : {}),
                  url: `${window.location.origin}/products/${p.id}`,
                  ...(p.salePriceKrw
                    ? {
                        offers: {
                          '@type': 'Offer',
                          price: p.salePriceKrw,
                          priceCurrency: 'KRW',
                          availability:
                            p.stock > 0
                              ? 'https://schema.org/InStock'
                              : 'https://schema.org/OutOfStock'
                        }
                      }
                    : {})
                }
              }))
            }}
          />
          <div
            className="product-grid"
            data-testid="product-grid"
            data-product-count={products.length}
          >
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
