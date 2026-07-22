import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/modelCatalog.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
  fileName: 'lib/modelCatalog.ts',
});
const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
const builtFile = join(tmpdir(), `keepsake-model-router-${process.pid}-${Date.now()}.mjs`);
await writeFile(builtFile, compiled.outputText, 'utf8');
const {
  NOVITA_MODEL_IDS,
  routeNovitaModels,
  estimateModelCostUsd,
  formatEstimatedCost,
} = await import(pathToFileURL(builtFile).href);

test('Auto routes routine writing to the economy model first', () => {
  const route = routeNovitaModels({ mode: 'auto', tier: 'fast', task: 'writer', promptLength: 1200 });
  assert.equal(route.resolvedMode, 'economy');
  assert.equal(route.models[0], NOVITA_MODEL_IDS.economy);
  assert.equal(route.models[1], NOVITA_MODEL_IDS.balanced);
});

test('Auto routes grounded library reasoning to balanced', () => {
  const route = routeNovitaModels({ mode: 'auto', tier: 'smart', task: 'library', promptLength: 20_000 });
  assert.equal(route.resolvedMode, 'balanced');
  assert.equal(route.models[0], NOVITA_MODEL_IDS.balanced);
});

test('Large complex work escalates to best with fallbacks', () => {
  const route = routeNovitaModels({ mode: 'auto', tier: 'smart', task: 'page', promptLength: 50_000 });
  assert.equal(route.resolvedMode, 'best');
  assert.deepEqual(route.models, [NOVITA_MODEL_IDS.best, NOVITA_MODEL_IDS.balanced, NOVITA_MODEL_IDS.economy]);
});

test('Manual modes are respected', () => {
  assert.equal(routeNovitaModels({ mode: 'economy', tier: 'best' }).models[0], NOVITA_MODEL_IDS.economy);
  assert.equal(routeNovitaModels({ mode: 'best', tier: 'fast' }).models[0], NOVITA_MODEL_IDS.best);
});

test('Stale direct-provider model IDs never leak into Novita routing', () => {
  const route = routeNovitaModels({
    mode: 'auto',
    tier: 'fast',
    task: 'writer',
    customModels: { fast: 'claude-haiku-4-5', smart: 'gpt-4o', best: 'gemini-2.5-pro' },
  });
  assert.deepEqual(route.models, [NOVITA_MODEL_IDS.economy, NOVITA_MODEL_IDS.balanced, NOVITA_MODEL_IDS.best]);
});

test('Known-model usage estimates calculate input, cache and output cost', () => {
  const cost = estimateModelCostUsd(NOVITA_MODEL_IDS.balanced, {
    promptTokens: 1_000_000,
    cachedTokens: 500_000,
    completionTokens: 1_000_000,
  });
  assert.ok(cost != null);
  assert.ok(Math.abs(cost - 0.364) < 0.000001);
  assert.equal(formatEstimatedCost(cost), '$0.364');
});
