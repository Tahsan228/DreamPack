import { useStore } from '../state/store';
import { getVersion } from '../core/versions';
import { Modal } from './mc/Modal';
import { MCProgress } from './mc/MCPrimitives';

export function ExportDialog() {
  const { exportStatus, dismissExport, targetVersion, projectName } = useStore();
  if (!exportStatus) return null;

  const version = getVersion(targetVersion);
  const { done, error, warnings } = exportStatus;

  return (
    <Modal title={done ? 'Pack exported' : error ? 'Export failed' : 'Exporting…'} onClose={dismissExport}>
      {error ? (
        <div className="t-red" style={{ lineHeight: 'var(--lh-body)' }}>
          {error}
        </div>
      ) : (
        <>
          <div className="mc-text-shadow" style={{ fontSize: 16, marginBottom: 8 }}>
            {exportStatus.phase}
          </div>
          <MCProgress ratio={exportStatus.ratio} />

          {done && (
            <div
              className="mc-text-shadow"
              style={{ fontSize: 16, marginTop: 12, lineHeight: 'var(--lh-body)' }}
            >
              <div className="t-green">
                {projectName}.zip downloaded - {exportStatus.fileCount} files
              </div>
              <div className="dim">
                pack_format {version.packFormat} · {version.label.trim()}
              </div>
              <div className="dim" style={{ fontSize: 16 }}>
                Drop it into <b>.minecraft/resourcepacks</b> and enable it in game.
              </div>
            </div>
          )}
        </>
      )}

      {warnings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            className="t-gold"
            style={{ marginBottom: 6 }}
          >
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </div>
          <div
            className="mc-inset"
            style={{ padding: 8, maxHeight: 200, overflowY: 'auto', background: '#0b0b0b' }}
          >
            {warnings.slice(0, 200).map((w, i) => (
              <div
                key={i}
                style={{ fontSize: 16, color: '#e0c060', lineHeight: 'var(--lh-body)', wordBreak: 'break-word' }}
              >
                • {w}
              </div>
            ))}
            {warnings.length > 200 && (
              <div style={{ fontSize: 16, color: '#888' }}>…and {warnings.length - 200} more</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
