import { BellRing, LineChart, Rocket, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';

const features = [
  { icon: LineChart, title: 'Live markets', text: 'Track NIFTY, SENSEX and 80+ stocks, ETFs and REITs tick by tick.' },
  { icon: Rocket, title: 'IPOs made simple', text: 'Bid for new issues and follow subscription and allotment status.' },
  { icon: BellRing, title: 'Never miss a move', text: 'Price alerts and instant order notifications.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'PIN-confirmed transactions and full session control.' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[linear-gradient(140deg,#312e81_0%,#4338ca_45%,#0f766e_100%)] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.15)" />
            <path d="M7 21l6-6 4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="25" cy="10" r="2" fill="#34d399" />
          </svg>
          StockSphere
        </div>
        <div className="relative mt-auto max-w-lg">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Invest with clarity. Trade with confidence.</h2>
          <p className="mt-4 text-white/75">One place for your portfolio, orders, IPO applications and funds — with real-time prices and alerts.</p>
          <ul className="mt-10 grid grid-cols-2 gap-6">
            {features.map(({ icon: Icon, title: featureTitle, text }) => (
              <li key={featureTitle}>
                <Icon className="size-5 text-emerald-300" />
                <p className="mt-2 font-medium">{featureTitle}</p>
                <p className="mt-1 text-sm text-white/65">{text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/50">Market data is simulated for demonstration purposes.</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
