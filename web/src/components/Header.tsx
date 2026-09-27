import { Link } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { shortAddress } from '../lib/wallet'
import { useAuth } from '../lib/auth'

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
      : `${user.name}님`
    : null

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand">
          직구창고
        </Link>
        <nav className="site-header__nav">
          <Link to="/" className="site-header__link site-header__link--home">
            상품
          </Link>
          <Link to="/orders" className="site-header__link">
            주문내역
          </Link>
          <Link to="/cart" className="site-header__cart">
            장바구니
            {count > 0 ? <span className="cart-badge">{count}</span> : null}
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
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link to="/signup" className="site-header__link site-header__link--signup">
                회원가입
              </Link>
              <Link to="/login" className="site-header__link">
                로그인
              </Link>
            </>
          )}
          {address ? (
            <button
              className="wallet-btn wallet-btn--connected"
              onClick={onDisconnect}
              title={address}
            >
              {shortAddress(address)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={onConnect}>
              지갑 연결
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
