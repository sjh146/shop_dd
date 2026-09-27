import { Link } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { shortAddress } from '../lib/wallet'
import { useAuth } from '../lib/auth'
import { BRAND, PAYMENT_LABEL } from '../lib/config'

interface HeaderProps {
  address: string | null
  onConnect: () => void
  onDisconnect: () => void
}

export function Header({ address, onConnect, onDisconnect }: HeaderProps) {
  const { count } = useCart()
  const { user, logout } = useAuth()

  const userLabel = user
    ? user.isWalletUser
      ? shortAddress(user.email.replace('@wallet.local', ''))
      : user.name
    : null

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand" aria-label={`${BRAND} home`}>
          {BRAND}
        </Link>
        <span
          className="brand-badge"
          data-testid="payment-badge"
          data-payment-method="metamask"
          title={`${PAYMENT_LABEL} — USDC checkout from your MetaMask wallet`}
        >
          {PAYMENT_LABEL}
        </span>
        <nav className="site-header__nav" aria-label="Main">
          <Link to="/" className="site-header__link" data-testid="shop-link">
            Shop
          </Link>
          <Link to="/orders" className="site-header__link" data-testid="orders-link">
            Orders
          </Link>
          <Link to="/cart" className="site-header__cart" data-testid="cart-link">
            Cart
            {count > 0 ? (
              <span className="cart-badge" data-testid="cart-count">
                {count}
              </span>
            ) : null}
          </Link>
          {user ? (
            <>
              <span className="site-header__user" title={user.email}>
                {userLabel}
              </span>
              <button
                type="button"
                className="site-header__link site-header__link--button"
                onClick={logout}
                data-testid="logout-button"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/signup"
                className="site-header__link site-header__link--signup"
                data-testid="signup-link"
              >
                Sign up
              </Link>
              <Link to="/login" className="site-header__link" data-testid="login-link">
                Log in
              </Link>
            </>
          )}
          {address ? (
            <button
              className="wallet-btn wallet-btn--connected"
              onClick={onDisconnect}
              title={address}
              data-testid="wallet-disconnect"
              data-wallet-address={address}
            >
              {shortAddress(address)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={onConnect} data-testid="wallet-connect">
              Connect MetaMask
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
