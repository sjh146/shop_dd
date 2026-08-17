import { Link } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { shortAddress } from '../lib/wallet'

interface HeaderProps {
  address: string | null
  onConnect: () => void
  onDisconnect: () => void
}

export function Header({ address, onConnect, onDisconnect }: HeaderProps) {
  const { count } = useCart()

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand">
          직구창고
        </Link>
        <nav className="site-header__nav">
          <Link to="/" className="site-header__link">
            상품
          </Link>
          <Link to="/orders" className="site-header__link">
            주문내역
          </Link>
          <Link to="/cart" className="site-header__cart">
            장바구니
            {count > 0 ? <span className="cart-badge">{count}</span> : null}
          </Link>
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
