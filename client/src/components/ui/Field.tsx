import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const controlBase =
  'w-full rounded-lg border bg-surface text-fg placeholder:text-subtle transition-colors outline-none ' +
  'focus:border-primary focus:ring-3 focus:ring-[color:var(--ring)] disabled:opacity-60 disabled:bg-surface-2';

interface FieldShellProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, className, children }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-loss" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, className, containerClassName, id, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error} className={containerClassName}>
      <div className="relative flex items-center">
        {prefix && <span className="pointer-events-none absolute left-3 text-sm text-muted">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            controlBase,
            'h-10 px-3 text-sm',
            error ? 'border-loss' : 'border-border',
            prefix ? 'pl-8' : '',
            suffix ? 'pr-10' : '',
            className,
          )}
          {...props}
        />
        {suffix && <span className="absolute right-2 flex items-center text-sm text-muted">{suffix}</span>}
      </div>
    </FieldShell>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, containerClassName, id, children, ...props },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <FieldShell id={selectId} label={label} hint={hint} error={error} className={containerClassName}>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={Boolean(error) || undefined}
        className={cn(controlBase, 'h-10 px-3 pr-8 text-sm', error ? 'border-loss' : 'border-border', className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, containerClassName, id, ...props },
  ref,
) {
  const generated = useId();
  const textareaId = id ?? generated;
  return (
    <FieldShell id={textareaId} label={label} hint={hint} error={error} className={containerClassName}>
      <textarea
        ref={ref}
        id={textareaId}
        aria-invalid={Boolean(error) || undefined}
        className={cn(controlBase, 'min-h-20 px-3 py-2 text-sm', error ? 'border-loss' : 'border-border', className)}
        {...props}
      />
    </FieldShell>
  );
});

/** Masked 4-digit transaction PIN entry. */
export const PinInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'maxLength' | 'inputMode'>>(function PinInput(
  { label = 'Transaction PIN', ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      label={label}
      type="password"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={4}
      pattern="\d{4}"
      placeholder="••••"
      className="text-center text-lg tracking-[0.6em]"
      {...props}
      onChange={(event) => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
        props.onChange?.(event);
      }}
    />
  );
});
