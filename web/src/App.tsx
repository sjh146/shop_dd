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
import { connect, hasEthereum, getChainId, BASE_SEPOLIA_CHAIN_ID } from './lib/wallet'

export default function App() {
  const [address, setAddress] = useState<string | null>(null)

  const handleConnect = async () => {
    if (!hasEthereum()) return
    try {
      const addr = await connect()
      setAddress(addr)
      const chainId = await getChainId()
      if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
        // Header just shows connected; checkout handles network switch.
      }
    } catch {
      // silent — user cancelled
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
