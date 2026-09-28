import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePanelShortcut, shortcutFromEvent, matchesPanelShortcut, panelShortcutAria } from '../source/panel/host/controlPanelShortcut.ts';
import { resolveSettings } from '../source/panel/host/settings.ts';

const key = (overrides = {}) => ({ key: ' ', code: 'Space', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, isComposing: false, keyCode: 32, defaultPrevented: false, getModifierState: () => false, ...overrides });

test('panel shortcuts reject ordinary typing, navigation, close commands and malformed modifiers', () => {
  for (const value of ['', 'A', 'Shift+A', 'Tab', 'Escape', 'Ctrl+W', 'Alt+F4', 'Command+Q', 'Ctrl+Ctrl+K', 'Other+K', 'F25']) {
    assert.equal(normalizePanelShortcut(value), null, value);
  }
  assert.equal(normalizePanelShortcut('alt+control+k'), 'Ctrl+Alt+K');
  assert.equal(normalizePanelShortcut('f12'), 'F12');
  assert.equal(normalizePanelShortcut('Meta+Space'), 'Command+Space');
  assert.equal(panelShortcutAria('Ctrl+Alt+K'), 'Control+Alt+K');
});

test('panel shortcuts ignore IME, AltGraph, consumed events and mismatched modifiers', () => {
  assert.equal(matchesPanelShortcut(key(), 'Ctrl+Space'), true);
  for (const overrides of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { shiftKey: true }, { getModifierState: () => true }]) {
    assert.equal(matchesPanelShortcut(key(overrides), 'Ctrl+Space'), false);
  }
  assert.equal(shortcutFromEvent(key({ code: 'KeyK', key: 'k', altKey: true })), 'Ctrl+Alt+K');
  assert.equal(shortcutFromEvent(key({ code: 'F8', key: 'F8', ctrlKey: false })), 'F8');
});

test('UI settings validate persisted input and fall back to a usable panel shortcut', () => {
  const invalid = resolveSettings({ 'control-panel-shortcut': 'Ctrl+W', 'show-titles': 'true', 'poster-tint-gradient': 'url(x)' });
  assert.equal(invalid.controlPanelShortcut, 'Ctrl+Space');
  assert.equal(invalid.showTitles, false);
  assert.equal(invalid.posterTintGradient, 'none');
  const valid = resolveSettings({ 'control-panel-shortcut': 'Ctrl+Alt+K', 'show-titles': true, 'poster-tint-gradient': 'vertical' });
  assert.equal(valid.controlPanelShortcut, 'Ctrl+Alt+K');
  assert.equal(valid.showTitles, true);
  assert.equal(valid.posterTintGradient, 'vertical');
});
