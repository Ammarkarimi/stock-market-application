import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

const DEMO = { email: 'demo@example.com', password: 'Demo@12345' };
const DEMO_ADMIN = { email: 'admin@example.com', password: 'Admin@12345' };

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ demo: boolean }>('/health'), staleTime: Infinity });

  const submit = async (credentials: { email: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(credentials.email.trim(), credentials.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ email, password });
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your StockSphere account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-loss/30 bg-loss-soft px-3 py-2.5 text-sm text-loss">
            {error}
          </div>
        )}
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Input
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          suffix={
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="rounded p-1 text-muted hover:text-fg" aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
        <Button type="submit" size="lg" loading={submitting} disabled={!email || !password}>
          Sign in
        </Button>
      </form>

      {health?.demo && (
        <div className="mt-6 rounded-xl border border-dashed border-border-strong bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" /> Explore with demo accounts
          </p>
          <p className="mt-1 text-xs text-muted">Pre-loaded with holdings, orders, IPO applications and alerts. Transaction PIN for the investor: 2468.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={submitting} onClick={() => void submit(DEMO)}>
              Investor demo
            </Button>
            <Button size="sm" variant="secondary" disabled={submitting} onClick={() => void submit(DEMO_ADMIN)}>
              Admin demo
            </Button>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-sm text-muted">
        New to StockSphere?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
