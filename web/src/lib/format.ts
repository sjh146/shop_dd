// ── Price formatting ─────────────────────────────────────────────────────────
// Catalog prices live in the database as KRW (Korean retail). U.S. customers see
// USD, converted with KRW_PER_USD — the same rate the server uses when it writes
// the on-chain USDC amount (server/internal/handlers/helpers.go).
import { KRW_PER_USD } from './config'
import type { Product } from './api'

/** KRW → USD cents. Matches the server: round(krw / 1350 * 100). */
export function usdCentsFromKrw(krw: number): number {
  return Math.round((krw / KRW_PER_USD) * 100)
}

/** "$4.37" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}$${whole.toLocaleString('en-US')}.${frac}`
}

/** "$4.37" from a KRW amount. */
export function formatUSD(krw: number): string {
  return formatCents(usdCentsFromKrw(krw))
}

/** "$4.37 USDC" from a micro-USDC amount (1 USDC = 1e6 micro). */
export function formatUsdcMicro(micro: number | string | null | undefined): string {
  const value = Number(micro ?? 0) / 1_000_000
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} USDC`
}

/** Discount percentage from original → sale price, or null when there is no discount. */
export function discountPct(product: Product): number | null {
  const sale = product.salePriceKrw
  const orig = product.originalPriceKrw
  if (!sale || !orig || orig <= 0 || sale <= 0 || sale >= orig) {
    return null
  }
  return Math.round((1 - sale / orig) * 100)
}
