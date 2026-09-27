import { useEffect, useState } from 'react'
import { getProducts, type Product } from '../lib/api'
import { ProductCard } from '../components/ProductCard'
import { JsonLd, usePageTitle } from '../lib/seo'
import {
  BRAND,
  CHAIN_ID,
  CHAIN_NAME,
  PAYMENT_LABEL,
  SHIPPING_COST_NOTE,
  SHIPPING_DETAIL,
  TESTNET
} from '../lib/config'
import { usdCentsFromKrw } from '../lib/format'

const STEPS = [
  {
    title: 'Pick your essentials',
    text: 'Browse everyday goods with prices in USD. Every item ships from Seoul, Korea.'
  },
  {
    title: 'Enter your U.S. address',
    text: 'At checkout tell us the street, city, state and ZIP we should deliver to.'
  },
  {
    title: 'Pay in USDC — we buy and ship',
    text: 'Connect MetaMask and pay in USDC. We place the Korean order and ship it to you.'
  }
]

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
        if (!cancelled) setError('We could not load the products. Please try again in a moment.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div>
            <span className="hero__eyebrow">Seoul → United States</span>
            <h1 className="hero__title">
              Everyday essentials from Korea, delivered to your U.S. door.
            </h1>
            <p className="hero__sub">
              Snacks, household goods, beauty and small electronics at Korean retail prices. We buy
              them in Seoul and ship them to your U.S. address — you check out in USDC from your
              MetaMask wallet.
            </p>
            <div className="hero__cta">
              <a className="btn btn--primary" href="#shop" data-testid="hero-shop-cta">
                Shop essentials
              </a>
              <a className="btn btn--secondary" href="#how" data-testid="hero-how-cta">
                How it works
              </a>
            </div>
            <div className="chips">
              <span className="chip chip--green">
                <span className="chip__dot" />
                Ships from Seoul
              </span>
              <span className="chip chip--usdc">
                <span className="chip__dot" />
                Pay in USDC
              </span>
              <span className="chip">
                <span className="chip__dot" />
                USD prices
              </span>
            </div>
          </div>

          <div className="hero__card" data-testid="hero-how-card">
            <div className="hero__card-head">
              <span className="hero__route">Seoul → your U.S. address</span>
              <span className="pay-strip__badge">{PAYMENT_LABEL}</span>
            </div>
            <div className="hero__card-row">
              <span className="hero__card-icon" aria-hidden="true">
                🛒
              </span>
              <div>
                <div className="hero__card-title">We buy it in Korea</div>
                <div className="hero__card-text">
                  Your order is placed with Korean retailers right after your USDC payment clears.
                </div>
              </div>
            </div>
            <div className="hero__card-row">
              <span className="hero__card-icon" aria-hidden="true">
                ✈️
              </span>
              <div>
                <div className="hero__card-title">Shipped to your U.S. address</div>
                <div className="hero__card-text">
                  Delivery to the address you enter at checkout, usually in 7–14 business days.
                </div>
              </div>
            </div>
            <div className="hero__card-row">
              <span className="hero__card-icon" aria-hidden="true">
                🦊
              </span>
              <div>
                <div className="hero__card-title">Paid with MetaMask</div>
                <div className="hero__card-text">
                  USD prices settled in USDC on {CHAIN_NAME}. No card, no bank transfer.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section__head">
            <div className="section__eyebrow">How it works</div>
            <h2 className="section__title">Three steps from Seoul to your door</h2>
            <p className="section__sub">
              {BRAND} is a personal shopping service: you pick the items, we buy them in Korea and
              ship them to you.
            </p>
          </div>
          <div className="steps">
            {STEPS.map((step, i) => (
              <div className="step" key={step.title} data-testid="how-step" data-step-index={i + 1}>
                <span className="step__num">{i + 1}</span>
                <div className="step__title">{step.title}</div>
                <p className="step__text">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="shop" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section__head">
            <div className="section__eyebrow">Shop</div>
            <h2 className="section__title">Today&rsquo;s essentials</h2>
            <p className="section__sub">
              Korean retail prices in USD. Stock is limited — we buy each order in Korea after you
              pay.
            </p>
          </div>

          <div
            className="pay-strip"
            data-testid="payment-notice"
            data-payment-method="metamask"
            data-payment-token="USDC"
            data-payment-network={CHAIN_NAME}
            data-payment-chain-id={CHAIN_ID}
            data-payment-mode={TESTNET ? 'testnet' : 'mainnet'}
          >
            <span className="pay-strip__badge">{PAYMENT_LABEL}</span>
            <span>
              Checkout takes USDC from your MetaMask wallet on {CHAIN_NAME}
              {TESTNET ? ' (test network — no real money moves)' : ''}.
            </span>
          </div>

          {loading ? (
            <div className="loading">Loading products…</div>
          ) : error ? (
            <div className="notice notice--error">{error}</div>
          ) : products.length === 0 ? (
            <div className="empty">No products are listed right now.</div>
          ) : (
            <>
              <JsonLd
                data={{
                  '@context': 'https://schema.org',
                  '@type': 'ItemList',
                  name: `${BRAND} product list`,
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
                              price: (usdCentsFromKrw(p.salePriceKrw) / 100).toFixed(2),
                              priceCurrency: 'USD',
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
      </section>

      <section className="section section--cream">
        <div className="container">
          <div className="info-grid">
            <div className="info-card" data-testid="info-shipping">
              <div className="info-card__title">Shipping &amp; delivery</div>
              <ul className="info-list">
                <li>{SHIPPING_DETAIL}</li>
                <li>Most orders arrive in 7–14 business days after we place the Korean order.</li>
                <li>{SHIPPING_COST_NOTE}</li>
                <li>We deliver to addresses in the United States.</li>
              </ul>
            </div>
            <div className="info-card" data-testid="info-payment">
              <div className="info-card__title">Payment &amp; checkout</div>
              <ul className="info-list">
                <li>MetaMask wallet only — no card details are collected.</li>
                <li>Prices are in USD and settled in USDC on {CHAIN_NAME}.</li>
                <li>You confirm the exact USDC amount in MetaMask before anything is sent.</li>
                <li>Order history and transaction hashes stay in your account.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
