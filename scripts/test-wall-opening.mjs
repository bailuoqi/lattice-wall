import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWallOpening } from '../source/panel/wallOpening.ts';
import { createStateOverlay } from '../source/panel/stateOverlay.ts';

test('boot and ready retain transparent opening; errors and empty libraries restore the background', () => {
  for (const outcome of ['empty', 'denied', 'error']) {
    const root = { dataset: { opening: 'true' } };
    const opening = createWallOpening(root);
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({}) };
    try {
      const overlay = createStateOverlay({ dataset: {}, replaceChildren() {}, append() {} }, {}, opening.finish);
      opening.configure({});
      overlay.show('booting');
      overlay.show('ready');
      assert.equal(root.dataset.opening, 'true');
      overlay.show(outcome);
      assert.equal(root.dataset.opening, undefined);
    } finally {
      if (previous) globalThis.document = previous;
      else delete globalThis.document;
    }
  }
});

test('desktop mode never keeps the entry transparency and finish cannot rearm it', () => {
  const root = { dataset: { opening: 'true' } };
  const opening = createWallOpening(root);
  opening.configure({ desktop: {} });
  assert.equal(root.dataset.opening, undefined);
  opening.configure({});
  opening.finish();
  assert.equal(root.dataset.opening, undefined);
});
