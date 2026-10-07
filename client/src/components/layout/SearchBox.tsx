import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { api, qs, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPercent, formatPrice } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { SecurityListItem } from '@/lib/types';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Type-ahead search for stocks, ETFs, REITs, InvITs and indices. Press "/" to focus. */
export function SearchBox({ className }: { className?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  const term = useDebounced(query.trim(), 150);

  const { data, isFetching } = useQuery({
    queryKey: keys.search(term),
    queryFn: () => api.get<{ items: SecurityListItem[] }>(`/securities/search${qs({ q: term, limit: 8 })}`),
    enabled: term.length > 0,
    staleTime: 10_000,
  });
  const items = term ? (data?.items ?? []) : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setActive(0), [term]);

  const go = (symbol: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    navigate(`/stocks/${symbolPath(symbol)}`);
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search stocks, ETFs and indices"
        placeholder="Search stocks, ETFs, indices…"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter') {
            if (items[active]) go(items[active].symbol);
            else if (term) {
              setOpen(false);
              navigate(`/explore${qs({ q: term })}`);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-10 text-sm text-fg placeholder:text-subtle outline-none transition-colors focus:border-primary focus:bg-surface"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-subtle sm:block">/</kbd>
      {open && term && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">{isFetching ? 'Searching…' : `No results for “${term}”`}</p>
          ) : (
            <ul id={listId} role="listbox">
              {items.map((item, index) => (
                <li
                  key={item.symbol}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    go(item.symbol);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn('flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5', index === active && 'bg-surface-2')}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-fg">{item.symbol}</span>
                      <Badge tone={item.type === 'INDEX' ? 'info' : item.type === 'STOCK' ? 'neutral' : 'primary'}>{item.type}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted">{item.name}</p>
                  </div>
                  <div className="num shrink-0 text-right text-sm">
                    <div className="text-fg">{formatPrice(item.lastPrice)}</div>
                    <div className={cn('text-xs', item.changePercent >= 0 ? 'text-gain' : 'text-loss')}>{formatPercent(item.changePercent)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setOpen(false);
              navigate(`/explore${qs({ q: term })}`);
            }}
            className="w-full border-t border-border px-4 py-2 text-left text-xs font-medium text-primary hover:bg-surface-2"
          >
            See all results for “{term}”
          </button>
        </div>
      )}
    </div>
  );
}
