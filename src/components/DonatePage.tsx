import { useEffect } from 'react';
import { Logo, MCButton } from './mc/MCPrimitives';
import { LINK_ICONS } from './mc/icons';
import { configured, DONATIONS, SOCIALS } from '../config/links';
import { playThud } from '../lib/sfx';

/**
 * A full-screen donation page, styled like a Minecraft menu screen: dirt
 * background, wordmark, a stack of buttons, and a Back button at the bottom.
 */
export function DonatePage({ onClose }: { onClose: () => void }) {
  const options = configured(DONATIONS);
  const socials = configured(SOCIALS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const back = () => {
    playThud();
    onClose();
  };

  return (
    <div className="screen" role="dialog" aria-modal="true" aria-label="Support DreamPack">
      <div className="screen-inner">
        <div aria-hidden="true">
          <Logo height={72} />
        </div>

        <h1 className="t-yellow screen-title">Support DreamPack</h1>

        <p className="screen-body">
          DreamPack is free, runs entirely in your browser, and has no ads,
          accounts or tracking. It is made in spare time.
        </p>
        <p className="screen-body t-gray">
          If it saved you an afternoon of unzipping packs by hand, a tip helps
          keep it going. Entirely optional! Nothing here is ever paywalled.
        </p>

        <div className="screen-buttons">
          {DONATIONS.map((o) => {
            const ready = o.url.trim().length > 0;
            return (
              <MCButton
                key={o.id}
                variant="primary"
                disabled={!ready}
                onClick={() => window.open(o.url, '_blank', 'noopener,noreferrer')}
                title={ready ? o.note ?? o.label : `${o.label} - coming soon`}
              >
                {o.label}
              </MCButton>
            );
          })}
        </div>

        {options.length === 0 && (
          <div className="t-yellow screen-soon">Coming soon!</div>
        )}

        {socials.length > 0 && (
          <>
            <div className="screen-body t-gray">Or just come and say hello:</div>
            <div className="screen-buttons">
              {socials.map((s) => {
                const Icon = LINK_ICONS[s.id];
                return (
                  <MCButton
                    key={s.id}
                    onClick={() => window.open(s.url, '_blank', 'noopener,noreferrer')}
                    title={s.note ?? s.label}
                  >
                    {Icon && <Icon size={20} />}
                    {s.label}
                  </MCButton>
                );
              })}
            </div>
          </>
        )}

        <MCButton onClick={back} style={{ marginTop: 24, minWidth: 260 }}>
          Back
        </MCButton>
      </div>
    </div>
  );
}
