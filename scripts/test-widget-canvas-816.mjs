import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../components/home/DashboardWidgets.tsx', import.meta.url), 'utf8');
const widgets = readFileSync(new URL('../lib/widgets.ts', import.meta.url), 'utf8');

test('desktop widget canvas reaches the viewport edges', () => {
  assert.match(dashboard, /md:w-\[calc\(100vw-3rem\)\]/);
  assert.match(dashboard, /md:max-w-none/);
  assert.match(dashboard, /Math\.max\(0, Math\.min\(Math\.max\(0, cw - s\.width\)/);
});

test('widgets have persistent pointer-based resize controls', () => {
  assert.match(dashboard, /onResizeDown/);
  assert.match(dashboard, /cursor-nwse-resize/);
  assert.match(dashboard, /width: resize\.width/);
  assert.match(dashboard, /height: resize\.height/);
  assert.match(dashboard, /widgetLayoutStore\.setValue\(next\)/);
});

test('stored widget layouts remain backward compatible', () => {
  assert.match(widgets, /width\?: number/);
  assert.match(widgets, /height\?: number/);
  assert.match(widgets, /fallback: \{\}/);
});
