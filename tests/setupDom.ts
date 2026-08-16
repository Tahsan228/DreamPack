import 'fake-indexeddb/auto';

// This setup file runs for every test, including the node-environment logic
// tests, so everything DOM-shaped has to be guarded.
if (typeof window !== 'undefined') {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

  // jsdom has no FontFaceSet; the boot sequence awaits document.fonts.ready.
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve(), check: () => true },
    });
  }

  URL.createObjectURL ??= () => 'blob:stub';
  URL.revokeObjectURL ??= () => {};

  // jsdom defines a getContext that throws "not implemented", so this has to
  // overwrite rather than fill in. Returning null is handled by every caller.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

  // jsdom reports every element as 0x0, which would leave the virtualized grid
  // with no visible rows. Give elements a viewport so cells actually render.
  const WIDTH = 800;
  const HEIGHT = 600;
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => WIDTH },
    clientHeight: { configurable: true, get: () => HEIGHT },
    offsetWidth: { configurable: true, get: () => WIDTH },
    offsetHeight: { configurable: true, get: () => HEIGHT },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: WIDTH, height: HEIGHT, top: 0, left: 0, right: WIDTH, bottom: HEIGHT,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
  };
}
