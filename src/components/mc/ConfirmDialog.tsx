import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { MCButton } from './MCPrimitives';

/**
 * A yes/no gate for the actions that cannot be taken back.
 *
 * Removing a pack drops every pick that pointed at it, and clearing picks
 * discards work that took hundreds of clicks to make - both were a single
 * unguarded click before this.
 */
export function ConfirmDialog({
  title,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={440}>
      <div className="mc-text-shadow" style={{ fontSize: 16, lineHeight: 'var(--lh-body)' }}>
        {children}
      </div>
      <div className="row" style={{ marginTop: 16, gap: 8, justifyContent: 'flex-end' }}>
        <MCButton onClick={onCancel}>{cancelLabel}</MCButton>
        <MCButton variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </MCButton>
      </div>
    </Modal>
  );
}
