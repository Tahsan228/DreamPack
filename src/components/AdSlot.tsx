import { useEffect, useRef } from 'react';
import { AD_CLIENT, AD_PLACEMENTS, type AdPlacementId } from '../config/ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * Elements already handed to AdSense.
 *
 * `adsbygoogle.push()` must run exactly once per <ins>; a second push against
 * the same element throws "All ins elements in the DOM with class=adsbygoogle
 * already have ads in them" and the unit stays blank. StrictMode re-runs
 * effects against the *same* DOM node, so a component-local ref would not
 * catch it — the element itself has to carry the mark.
 */
const filled = new WeakSet<Element>();

/**
 * Where the unit sits, which decides what chrome it wears.
 *
 * - `inset` goes inside a panel that already exists, so it draws only the same
 *   divider rule the other sections of that panel use.
 * - `panel` stands on its own and gets the app's dark panel frame, so it reads
 *   as another piece of the GUI rather than a box floating on the dirt.
 */
type AdVariant = 'inset' | 'panel';

/**
 * One AdSense display unit, dressed as part of the Minecraft GUI: the same
 * uppercase section heading as "Resource Packs" or "Viewport" above it, and the
 * same panel or divider treatment as whatever it sits in.
 *
 * A placement with no slot id yet renders nothing in a build, so an
 * unconfigured unit can never leave an empty labelled box on the live site.
 */
export function AdSlot({
  id,
  variant = 'panel',
  className = '',
}: {
  id: AdPlacementId;
  variant?: AdVariant;
  className?: string;
}) {
  const placement = AD_PLACEMENTS[id];
  const insRef = useRef<HTMLModElement>(null);
  const configured = placement.slot.trim().length > 0;

  useEffect(() => {
    if (!configured) return;

    /**
     * AdSense rejects an <ins> that is zero-width at push time
     * ("availableWidth=0") and does not retry on its own. The donate unit lives
     * in a screen that mounts later, and the rail and viewport units are inside
     * panels that only exist once a pack is loaded, so waiting for a real box
     * is the normal path here, not an edge case.
     */
    const tryFill = () => {
      const el = insRef.current;
      if (!el || filled.has(el) || el.offsetWidth === 0) return false;
      filled.add(el);
      try {
        (window.adsbygoogle = window.adsbygoogle ?? []).push({});
      } catch {
        // Blocked by an ad blocker, or the loader never arrived. The reserved
        // box simply stays empty — nothing else in the app depends on this.
      }
      return true;
    };

    if (tryFill()) return;

    const el = insRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (tryFill()) observer.disconnect();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [configured]);

  const shell = [
    'ad-slot',
    `ad-slot-${variant}`,
    variant === 'panel' ? 'mc-panel-dark' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!configured) {
    // Dev-only outline so the placement can be checked before the unit exists.
    if (!import.meta.env.DEV) return null;
    return (
      <div className={shell} aria-hidden="true">
        <div className="section-title">Advertisement</div>
        <div className="ad-slot-frame">
          <div className="ad-slot-empty" style={{ minHeight: placement.reserveHeight }}>
            <span className="t-gray">ad: {id}</span>
            <span className="t-gray ad-slot-note">{placement.note}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className={shell} aria-label="Advertisement">
      {/* AdSense permits only "Advertisement" or "Sponsored Links" as a label.
          Styled as a section heading so it matches the panel it sits in. */}
      <div className="section-title">Advertisement</div>
      <div className="ad-slot-frame" style={{ minHeight: placement.reserveHeight }}>
        <ins
          ref={insRef}
          className="adsbygoogle ad-slot-ins"
          style={{ display: 'block', width: '100%' }}
          data-ad-client={AD_CLIENT}
          data-ad-slot={placement.slot}
          data-ad-format={placement.format}
          data-full-width-responsive={placement.fullWidthResponsive ? 'true' : 'false'}
        />
      </div>
    </aside>
  );
}
