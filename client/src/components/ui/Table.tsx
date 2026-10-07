import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative min-w-0 overflow-x-auto scrollbar-thin', className)} {...props} />;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function Th({ className, align, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border bg-surface-2/60 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted first:pl-4 last:pr-4',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, align, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'border-b border-border px-3 py-2.5 first:pl-4 last:pr-4',
        align === 'right' ? 'num text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface-2/50 [&:last-child>td]:border-b-0', className)} {...props} />;
}
