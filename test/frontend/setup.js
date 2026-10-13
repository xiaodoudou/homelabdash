// jsdom has no matchMedia; the page reads one query (the phone width) when the store loads.
window.matchMedia ??= /** @type {any} */ ((/** @type {string} */ query) => ({ matches: false, media: query, addEventListener () {}, removeEventListener () {} }))
// No canvas in jsdom: the layout measures text at 12 px a character instead.
HTMLCanvasElement.prototype.getContext = /** @type {any} */ (() => null)
