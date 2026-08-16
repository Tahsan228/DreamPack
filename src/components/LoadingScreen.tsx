import { useEffect, useState } from 'react';
import { Logo } from './mc/MCPrimitives';

export interface BootState {
  ratio: number;
  phase: string;
  done: boolean;
}

/**
 * The startup screen, modelled on Minecraft's: dirt background, the wordmark,
 * and a progress bar underneath.
 *
 * The bar tracks real work — waiting on the font, generating the surface
 * textures, then reading saved packs out of IndexedDB — rather than animating a
 * fixed duration, so a big library genuinely takes longer than an empty one.
 */
export function LoadingScreen({ boot }: { boot: BootState }) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!boot.done) return;
    // Let the fade play out before the element leaves the tree.
    const id = window.setTimeout(() => setGone(true), 460);
    return () => window.clearTimeout(id);
  }, [boot.done]);

  if (gone) return null;

  const pct = Math.round(Math.max(0, Math.min(1, boot.ratio)) * 100);

  return (
    <div className={`boot ${boot.done ? 'is-done' : ''}`} role="status" aria-live="polite">
      <div className="boot-inner">
        {/* Decorative here: the header carries the real wordmark, and the phase
            text below is what a screen reader should announce. */}
        <div aria-hidden="true">
          <Logo height={88} />
        </div>
        <div className="boot-bar" aria-hidden="true">
          <div className="boot-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="boot-phase t-gray">{boot.phase}</div>
      </div>
    </div>
  );
}
