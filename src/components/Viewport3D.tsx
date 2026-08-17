import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SHAPES, type Shape3D } from '../core/blockShapes';
import { buildSpriteMesh, frameCount, solidMask } from '../lib/spriteGeometry';

/**
 * A small three.js scene for judging a texture the way it will actually look.
 *
 * Two things matter beyond just showing the picture. The solid has to match the
 * block - a bed wrapped around a full cube tells you nothing useful - and an
 * item has to have thickness, because Minecraft extrudes item sprites rather
 * than hanging them in the air as flat sheets.
 *
 * Nearest-neighbour filtering and no mipmaps throughout, so 16x16 art stays as
 * crisp as it is in game.
 */
export function Viewport3D({
  url,
  shape,
  size,
}: {
  url: string | null;
  shape: Shape3D;
  size: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    pivot: THREE.Group;
    mesh: THREE.Mesh | null;
    frame: number;
    dragging: boolean;
    lastX: number;
    lastY: number;
    spin: boolean;
  } | null>(null);

  // Scene setup runs once. The solid inside it is rebuilt as the shape or the
  // texture changes, so rotation and spin state survive both.
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
    // Framed off the cube's bounding sphere, so nothing clips at any angle and
    // shapes stay comparable in size as you switch between them.
    const radius = Math.sqrt(3) / 2;
    camera.position.set(0, 0, (radius / Math.sin((fov / 2) * (Math.PI / 180))) * 1.06);

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2.5, 4, 3);
    scene.add(key);
    // A second, dimmer light from behind keeps the far side of an extruded item
    // from going completely black as it turns.
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-2.5, -1, -3);
    scene.add(fill);

    const pivot = new THREE.Group();
    pivot.rotation.set(0.42, 0.7, 0);
    scene.add(pivot);

    const state = {
      renderer, scene, camera, pivot,
      mesh: null as THREE.Mesh | null,
      frame: 0, dragging: false, lastX: 0, lastY: 0, spin: true,
    };
    stateRef.current = state;

    const tick = () => {
      state.frame = requestAnimationFrame(tick);
      if (state.spin && !state.dragging) pivot.rotation.y += 0.008;
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
      pivot.rotation.y += (e.clientX - state.lastX) * 0.01;
      pivot.rotation.x += (e.clientY - state.lastY) * 0.01;
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
      disposeMesh(state.mesh, pivot);
      renderer.dispose();
      host.removeChild(canvas);
      stateRef.current = null;
    };
  }, [size]);

  // Rebuild the solid whenever the shape or the texture changes. An extruded
  // sprite is cut from the image's alpha, so this has to wait for the pixels.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    let cancelled = false;

    const install = (geometry: THREE.BufferGeometry, texture: THREE.Texture | null) => {
      if (cancelled) {
        geometry.dispose();
        texture?.dispose();
        return;
      }
      disposeMesh(state.mesh, state.pivot);

      const material = new THREE.MeshLambertMaterial({
        color: texture ? 0xffffff : 0x8b8b8b,
        map: texture,
        transparent: true,
        alphaTest: 0.05,
        // A cross or a flat face is a single sheet and has to read from behind;
        // a closed solid does not, and backface culling keeps its interior dark
        // rather than letting the far wall show through.
        side: shape === 'cross' || shape === 'flat' ? THREE.DoubleSide : THREE.FrontSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      const spec = SHAPES[shape];
      // A slab, bed or carpet sits on the floor. Lift it so the solid's base is
      // where the block's base would be, instead of floating mid-air.
      if (spec.grounded) mesh.position.y = -(1 - spec.size[1]) / 2;

      state.pivot.add(mesh);
      state.mesh = mesh;
    };

    if (!url) {
      install(geometryFor(shape, null), null);
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (cancelled) return;

      const texture = new THREE.Texture(image);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;

      // Animated textures are vertical filmstrips; show only the first frame.
      const frames = frameCount(image.naturalWidth, image.naturalHeight);
      if (frames > 1) {
        texture.repeat.set(1, 1 / frames);
        texture.offset.set(0, 1 - 1 / frames);
      }
      texture.needsUpdate = true;

      install(geometryFor(shape, image), texture);
    };
    image.onerror = () => {
      if (!cancelled) install(geometryFor(shape, null), null);
    };
    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [url, shape]);

  return (
    <div ref={hostRef} style={{ width: size, height: size, maxWidth: '100%', lineHeight: 0 }} />
  );
}

function disposeMesh(mesh: THREE.Mesh | null, parent: THREE.Group) {
  if (!mesh) return;
  parent.remove(mesh);
  mesh.geometry.dispose();
  const material = mesh.material as THREE.MeshLambertMaterial;
  material.map?.dispose();
  material.dispose();
}

/** Two sheets at right angles, the way Minecraft draws saplings and flowers. */
function crossGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1);
  b.rotateY(Math.PI / 2);
  return mergePlanes(a, b);
}

/** Minimal two-geometry merge, so three's BufferGeometryUtils is not needed. */
function mergePlanes(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;

  for (const name of attrs) {
    const av = a.getAttribute(name);
    const bv = b.getAttribute(name);
    const size = av.itemSize;
    const merged = new Float32Array(av.count * size + bv.count * size);
    merged.set(av.array as Float32Array, 0);
    merged.set(bv.array as Float32Array, av.count * size);
    out.setAttribute(name, new THREE.BufferAttribute(merged, size));
  }

  const ai = a.getIndex()!;
  const bi = b.getIndex()!;
  const indices = new Uint16Array(ai.count + bi.count);
  indices.set(ai.array as Uint16Array, 0);
  for (let i = 0; i < bi.count; i++) indices[ai.count + i] = bi.getX(i) + a.getAttribute('position').count;
  out.setIndex(new THREE.BufferAttribute(indices, 1));

  a.dispose();
  b.dispose();
  return out;
}

/**
 * Extrude the sprite into a solid using its alpha channel.
 *
 * Falls back to a flat plane if the pixels cannot be read - a tainted canvas, or
 * an image that never decoded - because a missing preview is worse than a flat
 * one.
 */
function extrudeSprite(image: HTMLImageElement): THREE.BufferGeometry {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const frames = frameCount(width, height);
  const frameHeight = Math.max(1, Math.floor(height / frames));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = frameHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || width === 0) return new THREE.PlaneGeometry(1, 1);

  ctx.imageSmoothingEnabled = false;
  // Draw only the first frame; the rest of a filmstrip share its silhouette.
  ctx.drawImage(image, 0, 0, width, frameHeight, 0, 0, width, frameHeight);

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, width, frameHeight);
  } catch {
    return new THREE.PlaneGeometry(1, 1);
  }

  const mask = solidMask(pixels.data, width, frameHeight);
  // Items are one sixteenth of a block thick whatever the texture resolution,
  // so an HD pack extrudes to the same depth as a 16x one.
  const arrays = buildSpriteMesh(mask, width, frameHeight, SHAPES.sprite.size[2]);
  if (arrays.indices.length === 0) return new THREE.PlaneGeometry(1, 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uvs, 2));
  geometry.setIndex(arrays.indices);
  return geometry;
}

function geometryFor(shape: Shape3D, image: HTMLImageElement | null): THREE.BufferGeometry {
  if (shape === 'cross') return crossGeometry();
  if (shape === 'flat') return new THREE.PlaneGeometry(1, 1);
  if (shape === 'sprite') {
    return image ? extrudeSprite(image) : new THREE.PlaneGeometry(1, 1);
  }
  const [x, y, z] = SHAPES[shape].size;
  return new THREE.BoxGeometry(x, y, z);
}
