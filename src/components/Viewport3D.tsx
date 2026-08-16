import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Mode = 'block' | 'item';

/**
 * A small three.js scene for judging a texture the way it will actually look:
 * wrapped on a block, or held flat like an item. Nearest-neighbour filtering and
 * no mipmaps, so 16x16 art stays as crisp as it is in game.
 */
export function Viewport3D({
  url,
  mode,
  size,
}: {
  url: string | null;
  mode: Mode;
  size: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    mesh: THREE.Mesh;
    frame: number;
    dragging: boolean;
    lastX: number;
    lastY: number;
    spin: boolean;
  } | null>(null);

  // Scene setup runs once per mode; only the texture swaps as picks change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // updateStyle must stay on: without it the canvas has no CSS size and is laid
    // out at its backing-buffer size, overflowing the panel on any HiDPI screen.
    renderer.setSize(size, size);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.maxWidth = '100%';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fov = 38;
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2.5, 4, 3);
    scene.add(key);

    // Blocks get a cube. Items get a flat quad rather than a thin box: a box
    // smears its edge texels down the side faces, which reads as coloured
    // streaks beside the sprite.
    const isBlock = mode === 'block';
    const geometry = isBlock ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1);

    // Frame the camera off the mesh's bounding sphere so no corner ever clips,
    // whatever angle the user drags it to.
    const radius = isBlock ? Math.sqrt(3) / 2 : Math.SQRT2 / 2;
    camera.position.set(0, 0, (radius / Math.sin((fov / 2) * (Math.PI / 180))) * 1.06);

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(isBlock ? 0.42 : 0.12, isBlock ? 0.7 : -0.35, 0);
    scene.add(mesh);

    const state = {
      renderer, scene, camera, mesh,
      frame: 0, dragging: false, lastX: 0, lastY: 0, spin: true,
    };
    stateRef.current = state;

    const tick = () => {
      state.frame = requestAnimationFrame(tick);
      if (state.spin && !state.dragging) mesh.rotation.y += 0.008;
      renderer.render(scene, camera);
    };
    tick();

    const canvas = renderer.domElement;
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    const onDown = (e: PointerEvent) => {
      state.dragging = true;
      state.spin = false;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!state.dragging) return;
      mesh.rotation.y += (e.clientX - state.lastX) * 0.01;
      mesh.rotation.x += (e.clientY - state.lastY) * 0.01;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      state.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    const onDouble = () => {
      state.spin = !state.spin;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);

    return () => {
      cancelAnimationFrame(state.frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDouble);
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
      host.removeChild(canvas);
      stateRef.current = null;
    };
  }, [mode, size]);

  // Texture swap.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const material = state.mesh.material as THREE.MeshLambertMaterial;

    if (!url) {
      material.map?.dispose();
      material.map = null;
      material.color.set(0x8b8b8b);
      material.needsUpdate = true;
      return;
    }

    let cancelled = false;
    new THREE.TextureLoader().load(url, (texture) => {
      if (cancelled) {
        texture.dispose();
        return;
      }
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;

      // Animated textures are vertical filmstrips; show only the first frame.
      if (texture.image && texture.image.height > texture.image.width) {
        const frames = Math.round(texture.image.height / texture.image.width);
        if (frames > 1) {
          texture.repeat.set(1, 1 / frames);
          texture.offset.set(0, 1 - 1 / frames);
        }
      }

      material.map?.dispose();
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div ref={hostRef} style={{ width: size, height: size, maxWidth: '100%', lineHeight: 0 }} />
  );
}
