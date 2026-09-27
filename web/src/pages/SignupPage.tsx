import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, friendlyAuthError } from '../lib/auth'
import { usePageTitle } from '../lib/seo'

export function SignupPage() {
  usePageTitle('Create account')
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
          <h1 className="auth-card__title">Create account</h1>
          <p className="auth-card__sub">
            Optional — but an account keeps your order history and shipping addresses in one place.
          </p>
        </div>

        {error ? (
          <div className="notice notice--error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        ) : null}

        <label className="form-field">
          <span className="form-field__label">Name</span>
          <input
            className="input"
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Kim"
            autoComplete="name"
            required
            data-testid="name-input"
          />
        </label>

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
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
            data-testid="password-input"
          />
          <span className="auth-card__hint">Use at least 8 characters.</span>
        </label>

        <button
          className="btn btn--primary btn--block"
          type="submit"
          disabled={busy}
          data-testid="signup-submit"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="auth-card__foot">
          Already have an account?{' '}
          <Link to="/login" className="text-link">
            Log in
          </Link>
        </p>
      </form>
    </div>
  )
}
