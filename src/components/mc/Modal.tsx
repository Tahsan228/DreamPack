import { useEffect, type ReactNode } from 'react';
import { MCButton } from './MCPrimitives';

export function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.7)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        className="mc-panel-dark"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <div
          className="row"
          style={{ padding: '8px 10px', borderBottom: '2px solid #101010' }}
        >
          <span className="t-yellow" style={{ fontSize: 24, lineHeight: 'var(--lh-title)' }}>
            {title}
          </span>
          <MCButton small style={{ marginLeft: 'auto' }} onClick={onClose}>
            ×
          </MCButton>
        </div>
        <div className="scroll" style={{ padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
