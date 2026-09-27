import { Link } from 'react-router-dom'
import {
  BRAND,
  CHAIN_NAME,
  PAYMENT_LABEL,
  SHIPPING_COST_NOTE,
  SUPPORT_EMAIL,
  TESTNET,
  TESTNET_NOTICE
} from '../lib/config'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__col">
          <div className="site-footer__brand">{BRAND}</div>
          <p className="site-footer__line">
            Everyday essentials bought in Seoul and shipped to U.S. addresses — snacks, household
            goods, beauty and small electronics.
          </p>
          <p className="site-footer__line site-footer__line--strong">
            {PAYMENT_LABEL} · USDC on {CHAIN_NAME}
            {TESTNET ? ' (testnet demo)' : ''}
          </p>
        </div>

        <div className="site-footer__col">
          <div className="site-footer__heading">Shop</div>
          <Link to="/" className="site-footer__line text-link">
            All products
          </Link>
          <Link to="/cart" className="site-footer__line text-link">
            Cart
          </Link>
          <Link to="/orders" className="site-footer__line text-link">
            Order history
          </Link>
        </div>

        <div className="site-footer__col">
          <div className="site-footer__heading">Payment</div>
          <span className="site-footer__line">MetaMask wallet only</span>
          <span className="site-footer__line">USDC · 6 decimals</span>
          <span className="site-footer__line">No card details needed</span>
        </div>

        <div className="site-footer__col">
          <div className="site-footer__heading">Shipping</div>
          <span className="site-footer__line">Ships from Seoul, Korea</span>
          <span className="site-footer__line">7–14 business days</span>
          <span className="site-footer__line">{SHIPPING_COST_NOTE}</span>
        </div>
      </div>

      <div className="site-footer__bottom">
        © {new Date().getFullYear()} {BRAND} · Prices in USD, settled in USDC.
        {SUPPORT_EMAIL ? ` · ${SUPPORT_EMAIL}` : ''}
        {TESTNET ? ` · ${TESTNET_NOTICE}` : ''}
      </div>
    </footer>
  )
}
