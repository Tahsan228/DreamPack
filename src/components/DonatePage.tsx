import { useEffect } from 'react';
import { Logo, MCButton } from './mc/MCPrimitives';
import { LINK_ICONS } from './mc/icons';
import { configured, DONATIONS, SOCIALS } from '../config/links';
import { anyAdConfigured } from '../config/ads';
import { AdSlot } from './AdSlot';
import { playThud } from '../lib/sfx';

/**
 * A full-screen donation page, styled like a Minecraft menu screen: dirt
 * background, wordmark, a stack of buttons, and a Back button at the bottom.
 */
export function DonatePage({ onClose }: { onClose: () => void }) {
  const options = configured(DONATIONS);
  const socials = configured(SOCIALS);
  const ads = anyAdConfigured();

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
          {/* Hyphen, not an em dash: Minecraftia has no glyph for one. */}
          DreamPack is free, needs no account, and runs entirely in your
          browser - your packs never leave your machine.
          {/* Only claimed once a unit is actually live, so the copy can never
              promise ads that are not there or deny ads that are. */}
          {ads ? ' A few ads cover the hosting.' : ''} It is made in spare time.
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

        {/*
         * Last, and well clear of Back. Above it the unit sat between two rows
         * of live buttons — the accidental-click layout AdSense suspends
         * accounts over — and on a phone it pushed Back off screen, which is
         * the only way out of this menu when there is no Escape key.
         */}
        <AdSlot id="donate" className="screen-ad" />
      </div>
    </div>
  );
}
