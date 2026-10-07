import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Underlined tab bar for switching page sections. */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-border scrollbar-thin', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-primary-soft' : 'bg-surface-3')}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/** Compact pill switcher for ranges and modes. */
export function Segmented<T extends string>({ options, value, onChange, size = 'sm', className, ...rest }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('inline-flex rounded-lg bg-surface-2 p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
              active ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
