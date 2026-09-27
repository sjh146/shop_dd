import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, friendlyAuthError } from '../lib/auth'
import { usePageTitle } from '../lib/seo'

export function LoginPage() {
  usePageTitle('로그인')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate('/')
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container page">
      <form className="auth-card" onSubmit={handleSubmit} data-testid="login-form">
        <div>
          <h1 className="auth-card__title">로그인</h1>
          <p className="auth-card__sub">이메일과 비밀번호로 로그인하세요.</p>
        </div>

        {error ? (
          <div className="notice notice--error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        ) : null}

        <label className="form-field">
          <span className="form-field__label">이메일</span>
          <input
            className="input"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            data-testid="email-input"
          />
        </label>

        <label className="form-field">
          <span className="form-field__label">비밀번호</span>
          <input
            className="input"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />
        </label>

        <button className="btn btn--primary btn--block" type="submit" disabled={busy} data-testid="login-submit">
          {busy ? '로그인 중…' : '로그인'}
        </button>

        <p className="auth-card__foot">
          아직 계정이 없나요?{' '}
          <Link to="/signup" className="text-link">
            회원가입
          </Link>
        </p>
      </form>
    </div>
  )
}
