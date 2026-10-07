import { Link } from 'react-router';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg" aria-label="StockSphere home">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--primary)" />
        <path d="M7 21l6-6 4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="10" r="2" fill="#34d399" />
      </svg>
      {!compact && <span className="text-[17px]">StockSphere</span>}
    </Link>
  );
}
