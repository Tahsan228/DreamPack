import { useEffect, useState } from 'react';
import { getText, getUrl, peekUrl } from './textureCache';

/** Object URL for a file inside a pack, resolved from the cache when already loaded. */
export function useTexture(packId: string | null, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    packId && path ? peekUrl(packId, path) : null,
  );

  useEffect(() => {
    if (!packId || !path) {
      setUrl(null);
      return;
    }
    const cached = peekUrl(packId, path);
    if (cached) {
      setUrl(cached);
      return;
    }

    let alive = true;
    setUrl(null);
    void getUrl(packId, path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [packId, path]);

  return url;
}

export interface AnimationMeta {
  frametime: number;
  frames: number[] | null;
  interpolate: boolean;
}

/**
 * Parse a texture's `.mcmeta` animation block. Returns null for still textures.
 * `frameCount` comes from the image itself since `.mcmeta` usually omits it.
 */
export function useAnimation(
  packId: string | null,
  mcmetaPath: string | null,
): AnimationMeta | null {
  const [meta, setMeta] = useState<AnimationMeta | null>(null);

  useEffect(() => {
    if (!packId || !mcmetaPath) {
      setMeta(null);
      return;
    }
    let alive = true;
    setMeta(null);

    void getText(packId, mcmetaPath).then((text) => {
      if (!alive || !text) return;
      try {
        const parsed = JSON.parse(text) as {
          animation?: { frametime?: number; frames?: Array<number | { index: number }>; interpolate?: boolean };
        };
        const anim = parsed.animation;
        if (!anim) return;
        setMeta({
          frametime: typeof anim.frametime === 'number' && anim.frametime > 0 ? anim.frametime : 1,
          frames: Array.isArray(anim.frames)
            ? anim.frames.map((f) => (typeof f === 'number' ? f : f.index))
            : null,
          interpolate: Boolean(anim.interpolate),
        });
      } catch {
        // Malformed .mcmeta files are common; treat the texture as still.
      }
    });

    return () => {
      alive = false;
    };
  }, [packId, mcmetaPath]);

  return meta;
}

/** Natural pixel dimensions of a loaded image URL. */
export function useImageSize(url: string | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!url) {
      setSize(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);

  return size;
}
