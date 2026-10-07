import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPercent, formatPrice } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { SecurityListItem } from '@/lib/types';

/** Inline search that hands the chosen symbol to `onSelect` (used to add to watchlists and alerts). */
export function SymbolPicker({ onSelect, placeholder = 'Search to add a stock or ETF…', exclude = [], className }: { onSelect: (symbol: string) => void; placeholder?: string; exclude?: string[]; className?: string }) {
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const { data } = useQuery({
    queryKey: keys.search(term),
    queryFn: () => api.get<{ items: SecurityListItem[] }>(`/securities/search${qs({ q: term, limit: 8 })}`),
    enabled: term.length > 0,
  });
  const items = (data?.items ?? []).filter((item) => !exclude.includes(item.symbol));

  const choose = (symbol: string) => {
    onSelect(symbol);
    setQuery('');
    setTerm('');
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, items.length - 1));
          if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
          if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            choose(items[active].symbol);
          }
        }}
        className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary"
      />
      {open && term && (
        <ul className="absolute left-0 right-0 top-11 z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-pop" role="listbox">
          {items.length === 0 && <li className="px-3 py-3 text-sm text-muted">No matches</li>}
          {items.map((item, index) => (
            <li
              key={item.symbol}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item.symbol);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2', index === active && 'bg-surface-2')}
            >
              <span className="min-w-0">
                <span className="font-semibold">{item.symbol}</span>
                <span className="block truncate text-xs text-muted">{item.name}</span>
              </span>
              <span className="num flex items-center gap-3 text-right text-sm">
                <span>
                  {formatPrice(item.lastPrice)}
                  <span className={cn('block text-xs', item.changePercent >= 0 ? 'text-gain' : 'text-loss')}>{formatPercent(item.changePercent)}</span>
                </span>
                <Plus className="size-4 text-primary" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
