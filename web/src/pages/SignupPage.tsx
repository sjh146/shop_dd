import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, friendlyAuthError } from '../lib/auth'
import { usePageTitle } from '../lib/seo'

export function SignupPage() {
  usePageTitle('회원가입')
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signup(email.trim(), password, name.trim())
      navigate('/')
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container page">
      <form className="auth-card" onSubmit={handleSubmit} data-testid="signup-form">
        <div>
          <h1 className="auth-card__title">회원가입</h1>
          <p className="auth-card__sub">이메일로 가입하고 주문 내역을 관리하세요.</p>
        </div>

        {error ? (
          <div className="notice notice--error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        ) : null}

        <label className="form-field">
          <span className="form-field__label">이름</span>
          <input
            className="input"
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            autoComplete="name"
            required
            data-testid="name-input"
          />
        </label>

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
            placeholder="8자 이상"
            autoComplete="new-password"
            minLength={8}
            required
            data-testid="password-input"
          />
          <span className="auth-card__hint">8자 이상 입력해 주세요.</span>
        </label>

        <button className="btn btn--primary btn--block" type="submit" disabled={busy} data-testid="signup-submit">
          {busy ? '가입 중…' : '회원가입'}
        </button>

        <p className="auth-card__foot">
          이미 계정이 있나요?{' '}
          <Link to="/login" className="text-link">
            로그인
          </Link>
        </p>
      </form>
    </div>
  )
}
