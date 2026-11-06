import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPosterWall } from '../source/panel/wall/posterWall.ts';
import { createCamera } from '../source/panel/wall/camera.ts';
import { DEFAULT_SETTINGS, wallVisualsFromSettings } from '../source/panel/host/settings.ts';

// The renderer only needs node ownership, attributes and style writes in these lifecycle tests.
class ElementStub {
  children = [];
  dataset = {};
  className = '';
  textContent = '';
  clientWidth = 1200;
  clientHeight = 800;
  parentElement = null;
  constructor(document) {
    this.ownerDocument = document;
    const properties = new Map();
    this.style = { setProperty: (key, value) => properties.set(key, value),
      removeProperty: key => properties.delete(key), getPropertyValue: key => properties.get(key) ?? '' };
    const classes = () => new Set(this.className.split(' ').filter(Boolean));
    this.classList = {
      add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...classes()].filter(name => !names.includes(name)).join(' '); },
      contains: name => classes().has(name),
    };
  }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  insertBefore(node, anchor) {
    node.remove(); node.parentElement = this;
    this.children.splice(this.children.indexOf(anchor), 0, node);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceWith(node) { const parent = this.parentElement; parent.insertBefore(node, this); this.remove(); }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  closest() { return null; }
  contains() { return false; }
  focus() {}
}

function fixture(t, reducedMotion = false) {
  const document = { activeElement: null, addEventListener() {},
    createElement() { return new ElementStub(this); } };
  document.body = document.createElement('body');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  globalThis.document = document;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  let wall;
  t.after(() => {
    wall?.dispose();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
    else delete globalThis.ResizeObserver;
  });
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  const field = document.createElement('div'), world = document.createElement('div');
  field.append(world);
  let completions = 0;
  wall = createPosterWall(world, { onFocusChange() {}, onExpandSettled() {}, onRenderNeeded() {},
    onEntranceComplete() { completions++; } });
  const instances = Array.from({ length: 30 }, (_, slot) => ({
    id: `0:0:${slot}`, bc: 0, br: 0, slot, tileIndex: slot,
    rect: { col: slot % 6 * 2, row: Math.floor(slot / 6) * 2, w: 2, h: 2 },
  }));
  const lat = { metrics: { gap: 4 }, unit: 100,
    toPixels: rect => ({ x: rect.col * 100, y: rect.row * 100, w: rect.w * 100 - 4, h: rect.h * 100 - 4 }),
    cull: () => instances,
    instanceAt: (_bc, _br, slot) => instances[slot],
  };
  const tiles = instances.map(({ tileIndex }) => ({ trackId: `track-${tileIndex}`, queueId: `queue-${tileIndex}`,
    title: `Tile ${tileIndex}`, artist: 'Artist', coverUrl: null }));
  const camera = createCamera({ x: 600, y: 400, scale: 1 });
  camera.setViewport(1200, 800);
  wall.setLattice(lat, tiles);
  wall.setVisualOptions(wallVisualsFromSettings(DEFAULT_SETTINGS, reducedMotion));
  return { wall, world, field, instances, lat, tiles,
    completions: () => completions,
    render: time => { clock = time; return wall.render(camera, time); } };
}

test('deferred viewport tiles share one random entrance timeline, including the expanded tile', t => {
  const { wall, world, instances, render } = fixture(t);
  t.mock.method(Math, 'random', () => 0);
  wall.setExpanded(instances[0]);
  wall.playEntrance(1000);
  render(1000);
  const first = [...world.children];
  assert.ok(first.length < 24, 'keep the first frame mount budget');
  assert.equal(first.find(card => card.dataset.expanded === 'true').classList.contains('poster--enter'), true);
  render(1016);
  const deferred = world.children.find(card => !first.includes(card));
  const index = instances.findIndex(instance => instance.id === deferred.dataset.instance);
  const scheduled = Math.round((index - 1) * .8 / 23 * 1000) / 1000;
  assert.ok(Math.abs(Number.parseFloat(deferred.style.getPropertyValue('--enter-delay')) - (scheduled - .016)) < 1e-9,
    'deferred tiles subtract elapsed time from the original delay');
  for (let time = 1016; time <= 1128; time += 16) render(time);
  const visible = world.children.filter(card => instances.find(instance => instance.id === card.dataset.instance).rect.row < 8);
  assert.equal(visible.length, 24);
  assert.ok(visible.every(card => card.classList.contains('poster--enter')));
  assert.ok(visible.every(card => !card.classList.contains('poster--fade')));
  const late = visible.find(card => !first.includes(card));
  const delay = Number.parseFloat(late.style.getPropertyValue('--enter-delay'));
  wall.playEntrance(1128);
  render(1144);
  assert.equal(Number.parseFloat(late.style.getPropertyValue('--enter-delay')), delay, 'do not restart entrance');
});

test('reduced motion cancels current and deferred entrances; page clear never rearms entry', t => {
  const { wall, world, lat, tiles, render } = fixture(t);
  wall.playEntrance(1000);
  render(1000);
  assert.ok(world.children.some(card => card.classList.contains('poster--enter')));
  wall.setVisualOptions(wallVisualsFromSettings(DEFAULT_SETTINGS, true));
  for (let time = 1016; time <= 1128; time += 16) render(time);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter') && !card.classList.contains('poster--fade')));
  wall.clear();
  wall.setLattice(lat, tiles);
  wall.setVisualOptions(wallVisualsFromSettings(DEFAULT_SETTINGS, false));
  wall.playEntrance(1200);
  render(1200);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
});

test('refresh, pagination and search clear the page without replaying black assembly', t => {
  const { wall, world, field, lat, tiles, render } = fixture(t);
  wall.playEntrance(1000);
  render(1000);
  assert.equal(field.dataset.entering, 'true');
  render(2100);
  assert.equal(field.dataset.entering, undefined);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
  for (let page = 0; page < 3; page++) {
    wall.clear();
    wall.setLattice(lat, tiles);
    wall.playEntrance(2200 + page * 200);
    render(2200 + page * 200);
    assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
    assert.equal(field.dataset.entering, undefined);
  }
});

test('starting with reduced motion skips entrance even if motion is subsequently enabled', t => {
  const { wall, world, render } = fixture(t, true);
  wall.playEntrance(1000);
  for (let time = 1000; time <= 1128; time += 16) render(time);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
  wall.setVisualOptions(wallVisualsFromSettings(DEFAULT_SETTINGS, false));
  wall.playEntrance(1200);
  render(1200);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
});

test('a fresh panel entry arms assembly again; unrelated render requests do not', t => {
  const { wall, world, render } = fixture(t);
  render(1000);
  assert.ok(world.children.every(card => !card.classList.contains('poster--enter')));
  wall.playEntrance(1200);
  render(1200);
  assert.ok(world.children.some(card => card.classList.contains('poster--enter')));
});

test('tiles mounted after a long idle gap do not replay an expired entrance', t => {
  const { wall, world, render } = fixture(t);
  wall.playEntrance(1000);
  render(1000);
  const first = [...world.children];
  render(3000);
  const late = world.children.filter(card => !first.includes(card));
  assert.ok(late.length > 0);
  assert.ok(late.every(card => !card.classList.contains('poster--enter') && card.classList.contains('poster--fade')));
});

test('the opening background is restored once, only after assembly and deferred mounts finish', t => {
  const { wall, render, completions } = fixture(t);
  wall.playEntrance(1000);
  render(1000);
  assert.equal(completions(), 0);
  for (let time = 1016; time < 2000; time += 16) render(time);
  assert.equal(completions(), 0);
  render(2000);
  assert.equal(completions(), 1);
  render(2200);
  wall.clear();
  assert.equal(completions(), 1);
});

test('reduced motion restores the background after the first viewport is mounted', t => {
  const { wall, render, completions } = fixture(t, true);
  wall.playEntrance(1000);
  render(1000);
  assert.equal(completions(), 0, 'do not expose a partly mounted wall on the first frame');
  for (let time = 1016; time <= 1128; time += 16) render(time);
  assert.equal(completions(), 1);
});

test('clearing an in-flight entrance restores the background and never rearms the transition', t => {
  const { wall, lat, tiles, render, completions } = fixture(t);
  wall.playEntrance(1000);
  render(1000);
  wall.clear();
  assert.equal(completions(), 1);
  wall.setLattice(lat, tiles);
  wall.playEntrance(1200);
  render(1200);
  assert.equal(completions(), 1);
});
