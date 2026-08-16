import { MCButton } from './mc/MCPrimitives';
import { LINK_ICONS } from './mc/icons';
import { SOCIALS } from '../config/links';

const SETUP_HINT = 'Not set up yet - add the URL in src/config/links.ts';

/**
 * Fixed buttons in the screen's top corners: socials on the left, donate on the
 * right. They sit either side of the centred wordmark, which is the only part
 * of the header with free space.
 *
 * Socials with no URL yet are shown disabled rather than hidden, so it is
 * obvious they exist and where to configure them.
 */
export function CornerLinks({ onOpenDonate }: { onOpenDonate: () => void }) {
  return (
    <>
      <div className="corner corner-left">
        {SOCIALS.map((s) => {
          const ready = s.url.trim().length > 0;
          const Icon = LINK_ICONS[s.id];
          return (
            <MCButton
              key={s.id}
              small
              disabled={!ready}
              title={ready ? s.note ?? s.label : `${s.label} - ${SETUP_HINT}`}
              onClick={() => window.open(s.url, '_blank', 'noopener,noreferrer')}
            >
              {Icon && <Icon />}
              {s.label}
            </MCButton>
          );
        })}
      </div>

      <div className="corner corner-right">
        <MCButton small variant="primary" onClick={onOpenDonate} title="Support DreamPack">
          Donate
        </MCButton>
      </div>
    </>
  );
}
