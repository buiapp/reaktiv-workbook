import { readFileSync } from 'node:fs';
// The real pre-paint theme API used by the app (no stub theme implementation).
if (typeof window !== 'undefined') window.eval(readFileSync('frontend/public/themes.js','utf8'));

// jsdom has no matchMedia; ProseKit's block handle and the theme helpers call it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no Web Animations API; ProseKit's popovers wait for animations to finish.
if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
}

// Native dialog focus/top-layer behavior is verified in WebKit; jsdom needs the API.
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
