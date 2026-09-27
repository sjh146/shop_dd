import { useEffect } from 'react'
import { BRAND, CHAIN_NAME, PAYMENT_LABEL } from './config'

/**
 * Per-page document title — lets search engines and AI agents identify the
 * current screen without parsing the DOM.
 */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title
      ? `${title} — ${BRAND}`
      : `${BRAND} — Korean essentials shipped to the U.S. (${PAYMENT_LABEL}, USDC on ${CHAIN_NAME})`
  }, [title])
}

/**
 * schema.org JSON-LD structured data — lets search engines and AI agents read
 * product name/price/stock without DOM parsing.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      data-testid="json-ld"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
