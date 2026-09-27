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

// ── 로그인 상태 (이메일 회원 + 지갑 사용자 공통) ─────────────────────────

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  /** 지갑 서명 로그인 등 외부에서 받은 인증 결과 반영 */
  adoptAuth: (res: { token: string; user: AuthUser }) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** 서버 에러 메시지를 사용자용 한국어로 변환 */
export function friendlyAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  if (msg.includes('invalid email or password')) return '이메일 또는 비밀번호가 올바르지 않아요.'
  if (msg.includes('email already registered')) return '이미 가입된 이메일이에요.'
  if (msg.includes('reserved domain')) return '사용할 수 없는 이메일 도메인이에요.'
  if (msg.includes("'email'")) return '이메일 형식을 확인해 주세요.'
  if (msg.includes("'min'")) return '비밀번호는 8자 이상이어야 해요.'
  return msg || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // 저장된 토큰으로 세션 복원
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
    await login(email, password) // 가입 직후 자동 로그인
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
