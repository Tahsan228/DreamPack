import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { VERSIONS } from '../core/versions';
import { Logo, MCButton, MCPanel } from './mc/MCPrimitives';
import { MCSelect } from './mc/MCSelect';
import { AUTHOR } from '../config/links';
import { isMuted, playClick, setMuted } from '../lib/sfx';

/** Picked once per load, the way the title screen picks one from splashes.txt. */
const SPLASHES = [
  'Block by block!',
  'Now with 100% more wool!',
  'Mix and match!',
  'Bedwars ready!',
  'Your packs, your rules!',
  'Pixel perfect!',
  'Also try vanilla!',
  'Drag to reorder!',
  '16x forever!',
  'Sword from pack B!',
  'No Mojang assets were harmed',
  'pack_format 1 gang',
];

export function TopBar({ onOpenProjects }: { onOpenProjects: () => void }) {
  const {
    targetVersion, setVersion, projectName, setProjectName,
    packs, exportPack, saveProject,
  } = useStore();
  const savedRef = useRef<HTMLSpanElement>(null);
  const [muted, setMutedState] = useState(isMuted);
  const [splash] = useState(() => SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);

  const handleSave = async () => {
    await saveProject();
    const el = savedRef.current;
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => {
      if (savedRef.current) savedRef.current.style.opacity = '0';
    }, 1600);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playClick();
  };

  return (
    <div className="topbar">
      {/* The wordmark gets its own band, like a Minecraft title screen. */}
      <div className="dp-title-band">
        {/* The splash is positioned against the logo, so it tracks its width. */}
        <div className="dp-logo-wrap">
          <Logo />
          <div className="dp-splash">{splash}</div>
        </div>
        <div className="dp-credit t-white">Made By {AUTHOR}</div>
      </div>

      <MCPanel style={{ padding: '8px 12px' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="t-gray" style={{ fontSize: 16 }}>
              VERSION
            </span>
            <MCSelect
              value={targetVersion}
              onChange={setVersion}
              width={196}
              label="Target Minecraft version"
              title="Target Minecraft version. Sets pack_format and the texture path names in the exported pack."
              options={VERSIONS.map((v) => ({
                value: v.id,
                label: v.label,
                hint: `fmt ${v.packFormat}`,
              }))}
            />
          </div>

          <div className="row" style={{ gap: 6, flex: 1, minWidth: 180 }}>
            <span className="t-gray" style={{ fontSize: 16 }}>
              NAME
            </span>
            <input
              className="mc-input"
              style={{ maxWidth: 240 }}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              spellCheck={false}
              aria-label="Pack name"
            />
          </div>

          <span
            ref={savedRef}
            className="t-green"
            style={{ opacity: 0, transition: 'opacity 200ms linear' }}
          >
            saved!
          </span>

          <div className="row">
            <MCButton
              small
              silent
              onClick={toggleMute}
              title={muted ? 'Sounds off - click to enable' : 'Sounds on - click to mute'}
              aria-pressed={!muted}
            >
              {/* Struck through rather than a slashed-note glyph, which the font lacks. */}
              <span style={muted ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                ♪
              </span>
            </MCButton>
            <MCButton onClick={onOpenProjects}>Projects</MCButton>
            <MCButton onClick={handleSave}>Save</MCButton>
            <MCButton variant="primary" onClick={exportPack} disabled={packs.length === 0}>
              Export Pack
            </MCButton>
          </div>
        </div>
      </MCPanel>
    </div>
  );
}
