import { useEffect, useId, useRef, useState } from 'react';
import { playClick } from '../../lib/sfx';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A dropdown built out of Minecraft widgets.
 *
 * A native <select> can be styled everywhere except the part that matters — the
 * popup list is drawn by the OS and always looks foreign. This renders the list
 * itself so it matches the rest of the GUI, while keeping the keyboard
 * behaviour people expect from a listbox.
 */
export function MCSelect({
  value,
  options,
  onChange,
  width,
  title,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  width?: number | string;
  title?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  // Close when focus or a click goes elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const commit = (next: string) => {
    playClick();
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const option = options[active];
      if (option) commit(option.value);
    }
  };

  return (
    <div className="mc-select-root" ref={rootRef} style={{ width }}>
      <button
        type="button"
        className={`mc-btn mc-select-btn ${open ? 'is-open' : ''}`}
        onClick={() => {
          playClick();
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
      >
        <span className="mc-select-value">{selected?.label ?? ''}</span>
        <span className="mc-select-arrow" aria-hidden="true" />
      </button>

      {open && (
        <ul className="mc-select-list" id={listId} role="listbox" tabIndex={-1}>
          {options.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`mc-select-option ${i === active ? 'is-active' : ''} ${
                  o.value === value ? 'is-selected' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o.value)}
                title={o.hint}
              >
                {o.label}
                {o.hint && <span className="mc-select-hint">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
