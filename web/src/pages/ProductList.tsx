import { useEffect, useState } from 'react'
import { getProducts, type Product } from '../lib/api'
import { ProductCard } from '../components/ProductCard'

export function ProductList() {
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
      <p className="page-sub">알리익스프레스 직배송 상품을 USDC로 결제하는 작은 직구 창고예요. 지금은 테스트넷이라 실제 결제는 없어요.</p>

      {loading ? (
        <div className="loading">불러오는 중…</div>
      ) : error ? (
        <div className="notice notice--error">{error}</div>
      ) : products.length === 0 ? (
        <div className="empty">상품이 없어요.</div>
      ) : (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  )
}
