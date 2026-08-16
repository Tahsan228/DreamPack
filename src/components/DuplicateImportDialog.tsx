import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { Modal } from './mc/Modal';
import { MCButton } from './mc/MCPrimitives';

/**
 * What to do about a zip whose name matches a pack already imported.
 *
 * Two packs called the same thing are hard to tell apart in the rail, and make
 * a shared .dreampack ambiguous - it matches saved picks back up by name.
 * Rather than guess, hold the import and ask.
 */
export function DuplicateImportDialog() {
  const { pendingDuplicates, resolveDuplicate } = useStore(
    useShallow((s) => ({
      pendingDuplicates: s.pendingDuplicates,
      resolveDuplicate: s.resolveDuplicate,
    })),
  );

  const entry = pendingDuplicates[0];
  if (!entry) return null;

  return (
    <Modal
      title="Already imported"
      width={460}
      onClose={() => void resolveDuplicate(entry.name, 'skip')}
    >
      <div className="mc-text-shadow" style={{ fontSize: 16, lineHeight: 'var(--lh-body)' }}>
        A pack called <span className="t-yellow">{entry.name}</span> is already in your library.
      </div>

      <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
        <MCButton
          variant="primary"
          onClick={() => void resolveDuplicate(entry.name, 'replace')}
          title="Delete the imported copy and import this zip in its place"
        >
          Replace
        </MCButton>
        <MCButton
          onClick={() => void resolveDuplicate(entry.name, 'keep')}
          title="Import anyway, under a numbered name"
        >
          Keep both
        </MCButton>
        <MCButton
          onClick={() => void resolveDuplicate(entry.name, 'skip')}
          style={{ marginLeft: 'auto' }}
        >
          Skip
        </MCButton>
      </div>

      <div className="t-gray" style={{ fontSize: 16, marginTop: 14, lineHeight: 'var(--lh-body)' }}>
        Replacing drops the picks that pointed at the old copy. Keeping both imports it as
        &quot;{entry.name} (2)&quot;.
        {pendingDuplicates.length > 1 && ` ${pendingDuplicates.length - 1} more to go.`}
      </div>
    </Modal>
  );
}
