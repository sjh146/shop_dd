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
import {
  connect,
  hasEthereum,
  getChainId,
  switchToBaseSepolia,
  BASE_SEPOLIA_CHAIN_ID,
  metamaskDeeplink,
  isMobileDevice,
  maybeOpenInMetaMaskApp
} from './lib/wallet'

export default function App() {
  const [address, setAddress] = useState<string | null>(null)
  const [walletNotice, setWalletNotice] = useState<string | null>(null)

  const handleConnect = async () => {
    // 모바일 브라우저 + 지갑 없음 → MetaMask 앱 내장 브라우저로 자동 이동
    if (maybeOpenInMetaMaskApp()) {
      setWalletNotice('MetaMask 앱으로 이동 중… 앱이 열리지 않으면 아래 버튼을 눌러주세요.')
      return
    }
    if (!(await hasEthereum())) {
      setWalletNotice(
        '지갑 연결에는 MetaMask가 필요해요. 데스크톱은 브라우저 확장(metamask.io/download)을 설치한 뒤 다시 시도해 주세요.'
      )
      return
    }
    setWalletNotice(null)
    try {
      const addr = await connect()
      setAddress(addr)
      try {
        const chainId = await getChainId()
        if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
          await switchToBaseSepolia()
        }
      } catch {
        // 네트워크 전환은 체크아웃에서 다시 안내 — 연결 자체는 유지
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
      <Header
        address={address}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {walletNotice ? (
        <div className="container">
          <div className="notice notice--quiet" style={{ marginTop: 16 }}>
            {walletNotice}
            <div className="mt-8">
              {isMobileDevice() ? (
                <a className="btn btn--secondary" href={metamaskDeeplink()} data-testid="open-metamask-app">
                  MetaMask 앱에서 열기
                </a>
              ) : (
                <a
                  className="btn btn--secondary"
                  href="https://metamask.io/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="install-metamask-extension"
                >
                  MetaMask 확장 설치
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
