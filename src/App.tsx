import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { DirtBackground } from './components/mc/MCPrimitives';
import { installTextures } from './lib/textures';
import { TopBar } from './components/TopBar';
import { PackRail } from './components/PackRail';
import { SlotGrid } from './components/SlotGrid';
import { Viewport } from './components/Viewport';
import { ExportDialog } from './components/ExportDialog';
import { ProjectsDialog } from './components/ProjectsDialog';
import { TextureEditor } from './components/TextureEditor';
import { LoadingScreen, type BootState } from './components/LoadingScreen';
import { CornerLinks } from './components/CornerLinks';
import { DonatePage } from './components/DonatePage';
import { preloadSounds } from './lib/sfx';

/** Floor on each boot step, so the bar and its phase label are legible. */
const MIN_STEP_MS = 220;

export function App() {
  const { hydrate, ready, importFiles, editingKey, closeEditor } = useStore();
  const [showProjects, setShowProjects] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const [boot, setBoot] = useState<BootState>({
    ratio: 0.05,
    phase: 'Starting DreamPack',
    done: false,
  });

  useEffect(() => {
    let alive = true;

    /**
     * Run one boot step, holding it on screen long enough to be read. The work
     * itself is usually instant, so without a floor the bar would jump straight
     * to full and the phases would be unreadable.
     */
    const step = async (ratio: number, phase: string, work?: () => Promise<unknown> | void) => {
      if (!alive) return;
      setBoot({ ratio, phase, done: false });
      const started = Date.now();
      await work?.();
      const remaining = MIN_STEP_MS - (Date.now() - started);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    };

    void (async () => {
      // Without the font the whole layout reflows a moment after first paint.
      await step(0.2, 'Loading font', () => document.fonts?.ready?.catch(() => {}));
      await step(0.45, 'Building textures', () => {
        installTextures();
        // Decode the click sample so the first button press is not a fallback.
        preloadSounds();
      });
      await step(0.7, 'Reading resource packs', () => hydrate());
      await step(1, 'Ready');
      if (alive) setBoot({ ratio: 1, phase: 'Ready', done: true });
    })();

    return () => {
      alive = false;
    };
  }, [hydrate]);

  // Dropping a zip anywhere in the window imports it.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.some((f) => f.name.toLowerCase().endsWith('.zip'))) {
        e.preventDefault();
        void importFiles(files);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  return (
    <>
      <DirtBackground />
      <CornerLinks onOpenDonate={() => setShowDonate(true)} />
      <div className="app">
        <TopBar onOpenProjects={() => setShowProjects(true)} />
        {ready && (
          <>
            <PackRail />
            <SlotGrid />
            <Viewport />
          </>
        )}
      </div>
      <ExportDialog />
      {showProjects && <ProjectsDialog onClose={() => setShowProjects(false)} />}
      {editingKey && <TextureEditor slotKey={editingKey} onClose={closeEditor} />}
      {showDonate && <DonatePage onClose={() => setShowDonate(false)} />}
      <LoadingScreen boot={boot} />
    </>
  );
}
