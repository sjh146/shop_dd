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
import { connect, hasEthereum, getChainId, switchToBaseSepolia, BASE_SEPOLIA_CHAIN_ID } from './lib/wallet'

export default function App() {
  const [address, setAddress] = useState<string | null>(null)
  const [walletNotice, setWalletNotice] = useState<string | null>(null)

  const handleConnect = async () => {
    if (!hasEthereum()) {
      setWalletNotice(
        '지갑 연결하려면 브라우저에 MetaMask 확장 프로그램이 필요해요. ' +
          'https://metamask.io/download/ 에서 설치한 뒤 이 페이지를 새로고침해주세요.'
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
    <>
      <Header
        address={address}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {walletNotice ? (
        <div className="container">
          <div className="notice notice--quiet" style={{ marginTop: 16 }}>
            {walletNotice}
          </div>
        </div>
      ) : null}
      <main>
        <Routes>
          <Route path="/" element={<ProductList />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
