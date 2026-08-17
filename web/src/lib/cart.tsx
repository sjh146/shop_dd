import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export interface CartItem {
  productId: number
  qty: number
}

interface CartContextValue {
  items: CartItem[]
  addItem: (productId: number, qty: number) => void
  removeItem: (productId: number) => void
  setQty: (productId: number, qty: number) => void
  clear: () => void
  count: number
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = 'shop_dd_cart'

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CartItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const value = useMemo<CartContextValue>(() => {
    const addItem = (productId: number, qty: number) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === productId)
        if (existing) {
          return prev.map((i) =>
            i.productId === productId ? { ...i, qty: i.qty + qty } : i
          )
        }
        return [...prev, { productId, qty }]
      })
    }

    const removeItem = (productId: number) => {
      setItems((prev) => prev.filter((i) => i.productId !== productId))
    }

    const setQty = (productId: number, qty: number) => {
      if (qty <= 0) {
        removeItem(productId)
        return
      }
      setItems((prev) =>
        prev.map((i) => (i.productId === productId ? { ...i, qty } : i))
      )
    }

    const clear = () => setItems([])

    const count = items.reduce((acc, i) => acc + i.qty, 0)

    return { items, addItem, removeItem, setQty, clear, count }
  }, [items])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) {
    throw new Error('useCart must be used within CartProvider')
  }
  return ctx
}
