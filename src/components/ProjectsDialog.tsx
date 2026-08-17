import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './mc/Modal';
import { ConfirmDialog } from './mc/ConfirmDialog';
import { MCButton } from './mc/MCPrimitives';
import type { Project } from '../core/types';

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const {
    savedProjects, loadProject, deleteProject, saveProject,
    exportProjectFile, importProjectFile,
    description, setDescription, picks, packOrder,
  } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  /** Why a load did not do what was expected. Success closes instead. */
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Close on a clean load; stay open and explain when packs are missing.
   *
   * Applying whatever matched and closing regardless is what made a failed load
   * indistinguishable from a successful one.
   */
  const handleLoad = async (run: Promise<{ ok: boolean; message: string }>) => {
    const result = await run;
    if (result.ok) onClose();
    else setProblem(result.message);
  };

  if (deleting) {
    return (
      <ConfirmDialog
        title="Delete project"
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          void deleteProject(deleting.id);
          setDeleting(null);
        }}
      >
        Delete &quot;{deleting.name}&quot;? Its {Object.keys(deleting.picks).length} saved picks
        go with it. The packs themselves are not touched.
      </ConfirmDialog>
    );
  }

  return (
    <Modal title="Projects" onClose={onClose}>
      <div className="mc-text-shadow" style={{ fontSize: 16, marginBottom: 4 }}>
        PACK DESCRIPTION
      </div>
      <input
        className="mc-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Shown under the pack name in Minecraft"
        spellCheck={false}
      />

      <div
        className="t-gray"
        style={{ fontSize: 16, marginTop: 10, lineHeight: 'var(--lh-body)' }}
      >
        {Object.keys(picks).length} manual picks · {packOrder.length} packs in priority
      </div>

      <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
        <MCButton onClick={() => void saveProject()}>Save current</MCButton>
        <MCButton onClick={exportProjectFile} title="Download a .dreampack file you can share or reload">
          Export .dreampack
        </MCButton>
        <MCButton onClick={() => fileRef.current?.click()}>Import .dreampack</MCButton>
        <input
          ref={fileRef}
          type="file"
          accept=".dreampack,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleLoad(importProjectFile(file));
            e.target.value = '';
          }}
        />
      </div>

      {problem && (
        <div
          className="mc-inset"
          style={{ padding: 8, marginTop: 10, background: '#1a1206' }}
        >
          <div className="t-gold" style={{ fontSize: 16, lineHeight: 'var(--lh-body)' }}>
            {problem}
          </div>
          <div
            className="t-gray"
            style={{ fontSize: 16, marginTop: 6, lineHeight: 'var(--lh-body)' }}
          >
            Whatever could be matched has been applied. Import the missing packs and
            load again to get the rest.
          </div>
        </div>
      )}

      <div className="section-title" style={{ padding: '16px 0 6px' }}>
        Saved in this browser
      </div>

      {savedProjects.length === 0 ? (
        <div className="t-gray" style={{ fontSize: 16, lineHeight: 'var(--lh-body)' }}>
          Nothing saved yet.
        </div>
      ) : (
        savedProjects.map((p) => (
          <div
            key={p.id}
            className="mc-panel"
            style={{ padding: 10, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <div style={{ flex: 1, minWidth: 0, color: '#1c1c1c' }}>
              <div style={{ fontSize: 16 }}>{p.name}</div>
              <div style={{ fontSize: 16, color: '#4b4b4b' }}>
                {p.targetVersion} · {Object.keys(p.picks).length} picks ·{' '}
                {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            <MCButton small onClick={() => void handleLoad(loadProject(p.id))}>
              load
            </MCButton>
            <MCButton small variant="danger" onClick={() => setDeleting(p)} title="Delete project">
              ×
            </MCButton>
          </div>
        ))
      )}

      <div
        className="t-gray"
        style={{ fontSize: 16, marginTop: 14, lineHeight: 'var(--lh-body)' }}
      >
        Imported packs stay in this browser between visits. A .dreampack file stores
        your picks only - whoever opens it needs the same source packs imported.
      </div>
    </Modal>
  );
}
