import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { ProductList } from './pages/ProductList'
import { ProductDetail } from './pages/ProductDetail'
import { CartPage } from './pages/CartPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { OrdersPage } from './pages/OrdersPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { AuthProvider } from './lib/auth'
import { TESTNET, TESTNET_NOTICE } from './lib/config'
import {
  connect,
  hasEthereum,
  getChainId,
  switchToPaymentChain,
  CHAIN_ID,
  metamaskDeeplink,
  isMobileDevice,
  maybeOpenInMetaMaskApp
} from './lib/wallet'

export default function App() {
  const [address, setAddress] = useState<string | null>(null)
  const [walletNotice, setWalletNotice] = useState<string | null>(null)

  const handleConnect = async () => {
    // Mobile browser without an injected wallet → hand off to the MetaMask in-app browser
    if (maybeOpenInMetaMaskApp()) {
      setWalletNotice('Opening the MetaMask app… If nothing happens, tap the button below.')
      return
    }
    if (!(await hasEthereum())) {
      setWalletNotice(
        'Connecting needs MetaMask. On desktop, install the browser extension from metamask.io/download and try again.'
      )
      return
    }
    setWalletNotice(null)
    try {
      const addr = await connect()
      setAddress(addr)
      try {
        const chainId = await getChainId()
        if (chainId !== CHAIN_ID) {
          await switchToPaymentChain()
        }
      } catch {
        // Network switching is re-prompted at checkout — the connection itself stays
      }
    } catch {
      // user cancelled — silent
    }
  }

  const handleDisconnect = () => {
    setAddress(null)
  }

  return (
    <AuthProvider>
      {TESTNET ? (
        <div className="demo-bar" data-testid="demo-bar" data-payment-mode="testnet">
          {TESTNET_NOTICE}
        </div>
      ) : null}
      <Header address={address} onConnect={handleConnect} onDisconnect={handleDisconnect} />
      {walletNotice ? (
        <div className="container">
          <div className="notice notice--quiet" style={{ marginTop: 16 }}>
            {walletNotice}
            <div className="mt-8">
              {isMobileDevice() ? (
                <a
                  className="btn btn--secondary"
                  href={metamaskDeeplink()}
                  data-testid="open-metamask-app"
                >
                  Open in MetaMask
                </a>
              ) : (
                <a
                  className="btn btn--secondary"
                  href="https://metamask.io/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="install-metamask-extension"
                >
                  Install MetaMask
                </a>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <main id="main">
        <Routes>
          <Route path="/" element={<ProductList />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </main>
      <Footer />
    </AuthProvider>
  )
}
