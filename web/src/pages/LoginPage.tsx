import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, friendlyAuthError } from '../lib/auth'
import { usePageTitle } from '../lib/seo'

export function LoginPage() {
  usePageTitle('Log in')
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
          <h1 className="auth-card__title">Log in</h1>
          <p className="auth-card__sub">
            Use your email and password — wallet checkout works without an account too.
          </p>
        </div>

        {error ? (
          <div className="notice notice--error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        ) : null}

        <label className="form-field">
          <span className="form-field__label">Email</span>
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
          <span className="form-field__label">Password</span>
          <input
            className="input"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />
        </label>

        <button
          className="btn btn--primary btn--block"
          type="submit"
          disabled={busy}
          data-testid="login-submit"
        >
          {busy ? 'Logging in…' : 'Log in'}
        </button>

        <p className="auth-card__foot">
          New here?{' '}
          <Link to="/signup" className="text-link">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  )
}
