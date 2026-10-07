import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AuthLayout } from './AuthLayout';

function passwordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  return { score, label: labels[score]! };
}

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const strength = passwordStrength(form.password);

  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (form.password !== form.confirmPassword) local.confirmPassword = 'Passwords do not match';
    if (!/^[6-9]\d{9}$/.test(form.phone)) local.phone = 'Enter a valid 10-digit mobile number';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await register(form);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start investing in minutes. It's free to open an account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg border border-loss/30 bg-loss-soft px-3 py-2.5 text-sm text-loss">
            {formError}
          </div>
        )}
        <Input label="Full name" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} required autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
          <Input label="Mobile number" type="tel" inputMode="numeric" autoComplete="tel-national" prefix="+91" maxLength={10} value={form.phone} onChange={set('phone')} error={errors.phone} required className="pl-11" />
        </div>
        <div>
          <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters with a letter and a number" required />
          {form.password && (
            <div className="mt-2 flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className={cn('h-1 flex-1 rounded-full', i < strength.score ? (strength.score <= 2 ? 'bg-loss' : strength.score === 3 ? 'bg-warning' : 'bg-gain') : 'bg-surface-3')} />
                ))}
              </div>
              <span className="w-20 text-right text-xs text-muted">{strength.label}</span>
            </div>
          )}
        </div>
        <Input label="Confirm password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} error={errors.confirmPassword} required />
        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>I understand that StockSphere uses simulated market data and agree to the terms of use.</span>
        </label>
        <Button type="submit" size="lg" loading={submitting} disabled={!accepted || !form.fullName || !form.email || !form.password}>
          Create account
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
