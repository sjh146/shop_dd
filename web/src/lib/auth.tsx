import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  clearToken,
  getMe,
  getToken,
  loginUser,
  registerUser,
  setToken,
  type AuthUser
} from './api'

// ── Auth state (email accounts and wallet users share it) ─────────────────

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  /** Adopt an auth result obtained elsewhere (e.g. the wallet signature flow) */
  adoptAuth: (res: { token: string; user: AuthUser }) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turn a server error message into customer-facing copy. */
export function friendlyAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  if (msg.includes('invalid email or password')) return 'That email or password is not correct.'
  if (msg.includes('email already registered')) return 'That email already has an account.'
  if (msg.includes('reserved domain')) return 'That email domain cannot be used.'
  if (msg.includes("'email'")) return 'Please check the email address format.'
  if (msg.includes("'min'")) return 'Passwords need at least 8 characters.'
  return msg || 'We could not complete that request. Please try again in a moment.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // Restore the session from a stored token
  useEffect(() => {
    if (!getToken()) {
      setReady(true)
      return
    }
    getMe()
      .then((res) => setUser(res.user))
      .catch(() => clearToken())
      .finally(() => setReady(true))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await loginUser(email, password)
    setToken(res.token)
    setUser(res.user)
  }

  const signup = async (email: string, password: string, name: string) => {
    await registerUser(email, password, name)
    await login(email, password) // sign in right after registering
  }

  const adoptAuth = (res: { token: string; user: AuthUser }) => {
    setToken(res.token)
    setUser(res.user)
  }

  const logout = () => {
    clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, adoptAuth, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
