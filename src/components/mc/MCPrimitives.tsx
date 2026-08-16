import { useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { playClick } from '../../lib/sfx';
import { dirtTile } from '../../lib/textures';

type Variant = 'default' | 'primary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  /** Suppress the click sound, for controls that make their own noise. */
  silent?: boolean;
}

export function MCButton({
  variant = 'default',
  small,
  silent,
  className = '',
  onClick,
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === 'primary' ? 'mc-btn-primary' : variant === 'danger' ? 'mc-btn-danger' : '';
  return (
    <button
      type="button"
      className={`mc-btn ${variantClass} ${small ? 'mc-btn-sm' : ''} ${className}`}
      onClick={(e) => {
        if (!silent) playClick();
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

export function MCPanel({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`mc-panel-dark ${className}`} style={style}>
      {children}
    </div>
  );
}

export function MCCheckbox({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  title?: string;
}) {
  return (
    <label className="mc-check" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      {/* Drawn in CSS rather than as a glyph - Minecraftia has no check mark. */}
      <span className={`mc-check-box ${checked ? 'is-on' : ''}`} aria-hidden="true" />
      {label}
    </label>
  );
}

export function MCProgress({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="mc-progress">
      <div className="mc-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The classic dirt menu background, generated at runtime so no Minecraft
 * artwork ships with the app. One 16x16 noise tile, scaled up with nearest
 * neighbour and darkened, exactly like the real title screen.
 */
export function DirtBackground() {
  const url = useMemo(() => dirtTile(), []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.62)), url(${url})`,
        backgroundSize: 'auto, 48px 48px',
        imageRendering: 'pixelated',
      }}
    />
  );
}

/**
 * The DreamPack wordmark.
 *
 * Drop your own artwork at `public/logo.png` and it is used automatically. Until
 * then this falls back to a CSS-extruded pixel wordmark in the same style, so the
 * header always looks finished.
 */
export function Logo({ height = 76 }: { height?: number }) {
  const [useImage, setUseImage] = useState(true);

  if (useImage) {
    return (
      <img
        src="./logo.png"
        alt="DreamPack"
        className="dp-logo-img"
        style={{ height }}
        onError={() => setUseImage(false)}
      />
    );
  }

  return (
    <div
      className="dp-logo-text"
      style={{ fontSize: height * 0.55 }}
      role="img"
      aria-label="DreamPack"
    >
      <span aria-hidden="true">DREAMPACK</span>
    </div>
  );
}

/**
 * A texture drawn at an integer zoom on a checkerboard, so 16x16 art stays
 * crisp and transparency is obvious.
 */
export function TexturePreview({
  src,
  size,
  animated = false,
  frame = 0,
  alt = '',
}: {
  src: string | null;
  size: number;
  /** Treat the image as a vertical filmstrip and show a single frame. */
  animated?: boolean;
  frame?: number;
  alt?: string;
}) {
  if (!src) {
    return (
      <div
        className="mc-checker"
        style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}
      >
        <span style={{ color: '#2b2b2b', fontSize: 16 }}>none</span>
      </div>
    );
  }

  // An animated texture is a vertical filmstrip: scale it so one frame fills the
  // box, then slide the strip up to the frame we want.
  if (animated) {
    return (
      <div
        className="mc-checker"
        style={{ width: size, height: size, overflow: 'hidden', position: 'relative' }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            position: 'absolute',
            left: 0,
            top: `-${frame * size}px`,
            width: size,
            height: 'auto',
            display: 'block',
          }}
        />
      </div>
    );
  }

  return (
    <div className="mc-checker" style={{ width: size, height: size }}>
      <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}
