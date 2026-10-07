import { useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';
import { Textarea } from './Field';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  /** Ask for a free-text reason (required, at least 3 characters). */
  requireReason?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', variant = 'primary', requireReason, loading, onConfirm, onClose }: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const invalid = requireReason && reason.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={loading}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={variant} loading={loading} disabled={invalid} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-muted">{description}</div>}
      {requireReason && (
        <Textarea
          containerClassName="mt-4"
          label="Reason"
          placeholder="This is recorded in the audit trail"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
        />
      )}
    </Modal>
  );
}
