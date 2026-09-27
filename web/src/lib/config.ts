// ── Store configuration ──────────────────────────────────────────────────────
// Single source of truth for brand, pricing and payment-mode strings.
//
// ⚠️ When flipping TESTNET to false (real payments on Base mainnet), also update:
//    web/index.html (title/meta/JSON-LD/body data-*), web/public/llms.txt,
//    web/public/robots.txt and server/.env (USDC_TOKEN_ADDRESS, PAYMENT_CONTRACT_ADDRESS).

export const BRAND = 'Seoul Crate'
export const TAGLINE = 'Korean everyday essentials, shipped to your U.S. door.'
export const BRAND_DESCRIPTION =
  'We buy in Seoul and ship to U.S. addresses. Checkout pays in USDC with MetaMask.'

/** Support inbox shown in the footer / order pages. Leave empty to hide the contact line. */
export const SUPPORT_EMAIL = ''

/**
 * KRW → USD conversion rate.
 * MUST stay in sync with the server: server/internal/handlers/helpers.go (krwToUsdcMicro)
 * and the same constant in web/src/lib/format.ts. The USDC charged on-chain is derived
 * from this rate, so a mismatch would show one price and charge another.
 */
export const KRW_PER_USD = 1350

/**
 * TESTNET mode — the payment contract currently runs on Base Sepolia.
 * While true the store shows an explicit demo notice and never claims real money moves.
 */
export const TESTNET = true

export const CHAIN_ID = TESTNET ? 84532 : 8453
export const CHAIN_NAME = TESTNET ? 'Base Sepolia' : 'Base'
export const EXPLORER_URL = TESTNET ? 'https://sepolia.basescan.org' : 'https://basescan.org'

/** Payment copy shared by the header badge, home strip, cart, checkout and footer. */
export const PAYMENT_LABEL = 'MetaMask only'
export const PAYMENT_SUMMARY = TESTNET
  ? `USDC on ${CHAIN_NAME} (testnet) — paid from your MetaMask wallet.`
  : `USDC on ${CHAIN_NAME} — paid from your MetaMask wallet.`

export const SHIPPING_NOTE = 'Ships from Seoul · delivery usually takes 7–14 business days'
export const SHIPPING_DETAIL =
  'We buy your items from major Korean retailers after you order, then ship them to your U.S. address.'
export const SHIPPING_COST_NOTE =
  'International shipping is quoted and confirmed with you before dispatch.'

export const TESTNET_NOTICE =
  'Demo store on a test network — payments use test USDC and no real money moves.'
