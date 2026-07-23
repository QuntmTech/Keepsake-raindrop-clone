import { readFile, writeFile, rm } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing expected source in ${path}: ${before.slice(0, 100)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one match in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

async function updateJson(path, mutate) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

await replaceOnce(
  'lib/types.ts',
  "export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';\n\n// Account tier. `owner` is you (unlimited, forever); `pro` is a paid customer;\n// `free` is the default limited tier. Stored on the user record (`plan`).\nexport type Plan = 'free' | 'pro' | 'owner';",
  "export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';\n\nexport type AiSelectionBuiltinAction =\n  | 'improve'\n  | 'summarize'\n  | 'explain'\n  | 'keypoints'\n  | 'reply'\n  | 'translate'\n  | 'grammar'\n  | 'shorten'\n  | 'professional';\nexport type AiSelectionActionRef = AiSelectionBuiltinAction | `custom:${string}`;\nexport interface AiSelectionCustomAction {\n  id: string;\n  label: string;\n  instruction: string;\n}\n\n// Account tier. `owner` is you (unlimited, forever); `pro` and `max` are paid;\n// `free` is the default limited tier. Stored on the user record (`plan`).\nexport type Plan = 'free' | 'pro' | 'max' | 'owner';",
);
await replaceOnce(
  'lib/types.ts',
  "  enableHighlights: boolean;\n  enableAiSelectionTools: boolean; // selected-text AI helper; never sends a whole field implicitly\n  enableAutoScreenshot: boolean;",
  "  enableHighlights: boolean;\n  enableAiSelectionTools: boolean; // selected-text AI helper; never sends a whole field implicitly\n  aiSelectionActions: AiSelectionActionRef[];\n  aiSelectionCustomActions: AiSelectionCustomAction[];\n  aiSelectionBlockedSites: string[];\n  aiSelectionTranslateLanguage: string;\n  aiSelectionShowForReading: boolean;\n  aiSelectionShowForWriting: boolean;\n  enableAutoScreenshot: boolean;",
);
await replaceOnce(
  'lib/types.ts',
  "  enableHighlights: true,\n  enableAiSelectionTools: true,\n  enableAutoScreenshot: true,",
  "  enableHighlights: true,\n  enableAiSelectionTools: true,\n  aiSelectionActions: ['improve', 'summarize', 'explain', 'reply', 'translate', 'shorten'],\n  aiSelectionCustomActions: [],\n  aiSelectionBlockedSites: [],\n  aiSelectionTranslateLanguage: 'English',\n  aiSelectionShowForReading: true,\n  aiSelectionShowForWriting: true,\n  enableAutoScreenshot: true,",
);

await replaceOnce(
  'lib/aiWriterPrompt.ts',
  "  | 'reply'\n  | 'translate'\n  | 'custom';",
  "  | 'reply'\n  | 'summarize'\n  | 'explain'\n  | 'keypoints'\n  | 'translate'\n  | 'custom';",
);
await replaceOnce(
  'lib/aiWriterPrompt.ts',
  "  reply: 'Draft a reply',\n  translate: 'Translate',",
  "  reply: 'Draft a reply',\n  summarize: 'Summarize',\n  explain: 'Explain simply',\n  keypoints: 'Extract key points',\n  translate: 'Translate',",
);
await replaceOnce(
  'lib/aiWriterPrompt.ts',
  "  reply:\n    'Write a ready-to-send reply to the source message. Infer an appropriate response from the message itself, stay concise, and do not mention that you are an AI.',\n};",
  "  reply:\n    'Write a ready-to-send reply to the source message. Infer an appropriate response from the message itself, stay concise, and do not mention that you are an AI.',\n  summarize:\n    'Summarize the source accurately and concisely. Preserve the main conclusion, important names, numbers, dates, caveats, and action items. Do not add outside facts.',\n  explain:\n    'Explain the source in clear plain language. Define difficult ideas, preserve important details, and do not introduce claims that are not supported by the source.',\n  keypoints:\n    'Extract the most useful key points as concise bullet points. Preserve important names, numbers, dates, caveats, conclusions, and action items. Do not invent facts.',\n};",
);

await replaceOnce(
  'lib/aiWriter.ts',
  "  const contextHeavy = request.action === 'custom' || request.action === 'reply' || request.action === 'translate';",
  "  const contextHeavy =\n    request.action === 'custom' ||\n    request.action === 'reply' ||\n    request.action === 'translate' ||\n    request.action === 'explain' ||\n    request.action === 'keypoints';",
);

await replaceOnce(
  'components/AIWriter.tsx',
  "  { action: 'humanize', label: 'Humanize' },\n  { action: 'shorten', label: 'Shorten' },\n  { action: 'reply', label: 'Reply' },",
  "  { action: 'humanize', label: 'Humanize' },\n  { action: 'summarize', label: 'Summarize' },\n  { action: 'reply', label: 'Reply' },",
);
await replaceOnce(
  'components/AIWriter.tsx',
  "  { action: 'casual', label: 'Casual' },\n  { action: 'translate', label: 'Translate' },\n];",
  "  { action: 'casual', label: 'Casual' },\n  { action: 'translate', label: 'Translate' },\n  { action: 'explain', label: 'Explain' },\n  { action: 'keypoints', label: 'Key points' },\n  { action: 'shorten', label: 'Shorten' },\n];",
);

await replaceOnce(
  'lib/messaging.ts',
  "  | { type: 'OPEN_AI_TOOLS'; text?: string; action?: WriterAction; source?: 'quickbar' | 'embedded' | 'context-menu' }",
  "  | {\n      type: 'OPEN_AI_TOOLS';\n      text?: string;\n      action?: WriterAction;\n      customInstruction?: string;\n      targetLanguage?: string;\n      source?: 'quickbar' | 'embedded' | 'context-menu';\n    }",
);
await replaceOnce(
  'lib/messaging.ts',
  "  | { type: 'KS_START_CHECKOUT'; interval: 'month' | 'year' }",
  "  | { type: 'KS_START_CHECKOUT'; plan: 'pro' | 'max'; interval: 'month' | 'year' }",
);

await replaceOnce(
  'entrypoints/background.ts',
  "          action: msg.action ?? 'improve',\n        });",
  "          action: msg.action ?? 'improve',\n          customInstruction: msg.customInstruction?.trim().slice(0, 1200) ?? '',\n          targetLanguage: msg.targetLanguage?.trim().slice(0, 80) || 'English',\n          selectedPromptId: '',\n        });",
);
await replaceOnce(
  'entrypoints/background.ts',
  "        const { url } = await backend.createCheckoutSession('pro', msg.interval);",
  "        const { url } = await backend.createCheckoutSession(msg.plan, msg.interval);",
);

await replaceOnce(
  'components/SettingsPanel.tsx',
  "import { AiEngineSettings } from './AiEngineSettings';",
  "import { AiEngineSettings } from './AiEngineSettings';\nimport { AiSelectionSettings } from './AiSelectionSettings';",
);
await replaceOnce(
  'components/SettingsPanel.tsx',
  "  const [billingBusy, setBillingBusy] = useState<'month' | 'year' | 'portal' | null>(null);",
  "  const [billingBusy, setBillingBusy] = useState<string | null>(null);",
);
await replaceOnce(
  'components/SettingsPanel.tsx',
  "  async function upgrade(interval: 'month' | 'year') {\n    setBillingBusy(interval);\n    try {\n      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_START_CHECKOUT', interval });",
  "  async function upgrade(targetPlan: 'pro' | 'max', interval: 'month' | 'year') {\n    const busyKey = `${targetPlan}-${interval}`;\n    setBillingBusy(busyKey);\n    try {\n      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_START_CHECKOUT', plan: targetPlan, interval });",
);
await replaceOnce(
  'components/SettingsPanel.tsx',
  "            {HOSTED && plan === 'free' && (\n              <div className=\"rounded-lg border border-line bg-surface-sunken p-3\">\n                <p className=\"text-sm font-medium text-ink\">Upgrade to Pro</p>\n                <p className=\"mt-0.5 text-xs text-ink-faint\">\n                  Unlimited cloud bookmarks, full Capture Studio, 25 active watches, and 10 GB storage.\n                </p>\n                <div className=\"mt-2 flex gap-2\">\n                  <button className=\"btn-outline flex-1\" onClick={() => upgrade('month')} disabled={billingBusy !== null}>\n                    {billingBusy === 'month' ? 'Opening…' : '$6.99/mo'}\n                  </button>\n                  <button className=\"btn-primary flex-1\" onClick={() => upgrade('year')} disabled={billingBusy !== null}>\n                    {billingBusy === 'year' ? 'Opening…' : '$49/yr — 7-day free trial'}\n                  </button>\n                </div>\n              </div>\n            )}\n\n            {HOSTED && plan === 'pro' && (\n              <button className=\"btn-outline\" onClick={manageBilling} disabled={billingBusy !== null}>\n                {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}\n              </button>\n            )}",
  "            {HOSTED && plan === 'free' && (\n              <div className=\"rounded-lg border border-line bg-surface-sunken p-3\">\n                <p className=\"text-sm font-medium text-ink\">Choose your AI plan</p>\n                <p className=\"mt-0.5 text-xs text-ink-faint\">\n                  Pro includes 2,500 hosted-AI credits monthly. Max includes 10,000 and full best-model access.\n                </p>\n                <div className=\"mt-2 grid grid-cols-2 gap-2\">\n                  <button className=\"btn-outline\" onClick={() => upgrade('pro', 'month')} disabled={billingBusy !== null}>\n                    {billingBusy === 'pro-month' ? 'Opening…' : 'Pro monthly'}\n                  </button>\n                  <button className=\"btn-outline\" onClick={() => upgrade('pro', 'year')} disabled={billingBusy !== null}>\n                    {billingBusy === 'pro-year' ? 'Opening…' : 'Pro yearly'}\n                  </button>\n                  <button className=\"btn-primary\" onClick={() => upgrade('max', 'month')} disabled={billingBusy !== null}>\n                    {billingBusy === 'max-month' ? 'Opening…' : 'Max monthly'}\n                  </button>\n                  <button className=\"btn-primary\" onClick={() => upgrade('max', 'year')} disabled={billingBusy !== null}>\n                    {billingBusy === 'max-year' ? 'Opening…' : 'Max yearly'}\n                  </button>\n                </div>\n              </div>\n            )}\n\n            {HOSTED && plan === 'pro' && (\n              <div className=\"grid grid-cols-2 gap-2\">\n                <button className=\"btn-primary\" onClick={() => upgrade('max', 'month')} disabled={billingBusy !== null}>\n                  {billingBusy === 'max-month' ? 'Opening…' : 'Upgrade to Max'}\n                </button>\n                <button className=\"btn-outline\" onClick={manageBilling} disabled={billingBusy !== null}>\n                  {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}\n                </button>\n              </div>\n            )}\n\n            {HOSTED && plan === 'max' && (\n              <button className=\"btn-outline\" onClick={manageBilling} disabled={billingBusy !== null}>\n                {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}\n              </button>\n            )}",
);
await replaceOnce(
  'components/SettingsPanel.tsx',
  "      <AiEngineSettings compact={compact} />\n\n      <Section",
  "      <AiEngineSettings compact={compact} />\n      <AiSelectionSettings settings={settings} plan={plan} compact={compact} update={update} />\n\n      <Section",
);
await replaceOnce(
  'components/SettingsPanel.tsx',
  "        <Toggle label=\"AI helper for selected text only\" checked={settings.enableAiSelectionTools} onChange={(v) => update({ enableAiSelectionTools: v })} />\n",
  '',
);

await replaceOnce(
  'components/PlanBadge.tsx',
  "      : plan === 'pro'\n        ? 'bg-emerald-500 text-white'\n        : 'bg-surface-sunken text-ink-soft';",
  "      : plan === 'max'\n        ? 'bg-violet-600 text-white'\n        : plan === 'pro'\n          ? 'bg-emerald-500 text-white'\n          : 'bg-surface-sunken text-ink-soft';",
);
await replaceOnce(
  'lib/plan.ts',
  "  pro: 'Pro',\n  owner: 'Owner',",
  "  pro: 'Pro',\n  max: 'Max',\n  owner: 'Owner',",
);

await replaceOnce(
  'lib/backend/types.ts',
  "  key: string; // 'free' | 'pro'",
  "  key: string; // 'free' | 'pro' | 'max'",
);
await replaceOnce(
  'lib/backend/types.ts',
  "  ai_credit_allowance: number | null;\n  capture_tier: string;",
  "  ai_credit_allowance: number | null;\n  ai_credit_period?: 'day' | 'month' | 'unlimited';\n  capture_tier: string;",
);
await replaceOnce(
  'lib/backend/types.ts',
  "  createCheckoutSession?(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }>;",
  "  createCheckoutSession?(plan: 'pro' | 'max', interval: 'month' | 'year'): Promise<{ url: string }>;",
);

await replaceOnce(
  'lib/backend/pocketbase.ts',
  "        ai_credit_allowance: r.ai_credit_allowance ?? null,\n        capture_tier:",
  "        ai_credit_allowance: r.ai_credit_allowance ?? null,\n        ai_credit_period: r.ai_credit_period === 'day' ? 'day' : r.ai_credit_period === 'unlimited' ? 'unlimited' : 'month',\n        capture_tier:",
);
await replaceOnce(
  'lib/backend/pocketbase.ts',
  "    const plan = r.plan === 'owner' || r.plan === 'pro' ? r.plan : 'free';",
  "    const plan = r.plan === 'owner' || r.plan === 'max' || r.plan === 'pro' ? r.plan : 'free';",
);
await replaceOnce(
  'lib/backend/pocketbase.ts',
  "  async createCheckoutSession(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }> {",
  "  async createCheckoutSession(plan: 'pro' | 'max', interval: 'month' | 'year'): Promise<{ url: string }> {",
);

await replaceOnce(
  'lib/entitlements.ts',
  "  aiCreditAllowance: number | null; // monthly hosted-AI credits; null = unlimited\n  captureTier:",
  "  aiCreditAllowance: number | null; // weighted hosted-AI credits; null = unlimited\n  aiCreditPeriod: 'day' | 'month' | 'unlimited';\n  captureTier:",
);
await replaceOnce(
  'lib/entitlements.ts',
  "export const PRO_AI_CREDIT_ALLOWANCE_DEFAULT = 1000;",
  "export const PRO_AI_CREDIT_ALLOWANCE_DEFAULT = 2_500;\nexport const MAX_AI_CREDIT_ALLOWANCE_DEFAULT = 10_000;",
);
await replaceOnce(
  'lib/entitlements.ts',
  "    hostedAi: false,\n    aiCreditAllowance: 0,\n    captureTier: 'basic',",
  "    hostedAi: true,\n    aiCreditAllowance: 15,\n    aiCreditPeriod: 'day',\n    captureTier: 'basic',",
);
await replaceOnce(
  'lib/entitlements.ts',
  "    hostedAi: true,\n    aiCreditAllowance: PRO_AI_CREDIT_ALLOWANCE_DEFAULT,\n    captureTier: 'full',",
  "    hostedAi: true,\n    aiCreditAllowance: PRO_AI_CREDIT_ALLOWANCE_DEFAULT,\n    aiCreditPeriod: 'month',\n    captureTier: 'full',",
);
await replaceOnce(
  'lib/entitlements.ts',
  "  owner: {\n    maxBookmarks: null,",
  "  max: {\n    maxBookmarks: null,\n    maxWatches: 100,\n    maxStorageBytes: 50 * GB,\n    hostedAi: true,\n    aiCreditAllowance: MAX_AI_CREDIT_ALLOWANCE_DEFAULT,\n    aiCreditPeriod: 'month',\n    captureTier: 'full',\n    stripePriceMonth: '',\n    stripePriceYear: '',\n  },\n  owner: {\n    maxBookmarks: null,",
);
await replaceOnce(
  'lib/entitlements.ts',
  "    aiCreditAllowance: null,\n    captureTier: 'full',",
  "    aiCreditAllowance: null,\n    aiCreditPeriod: 'unlimited',\n    captureTier: 'full',",
);
await replaceOnce(
  'lib/entitlements.ts',
  "    pro: { ...DEFAULT_PLANS.pro },\n    owner: { ...DEFAULT_PLANS.owner },",
  "    pro: { ...DEFAULT_PLANS.pro },\n    max: { ...DEFAULT_PLANS.max },\n    owner: { ...DEFAULT_PLANS.owner },",
);
await replaceOnce(
  'lib/entitlements.ts',
  "  plans: Partial<Record<'free' | 'pro', PlanLimits>>;",
  "  plans: Partial<Record<'free' | 'pro' | 'max', PlanLimits>>;",
);
await replaceOnce(
  'lib/entitlements.ts',
  "    aiCreditAllowance: row.ai_credit_allowance == null ? null : Number(row.ai_credit_allowance),\n    captureTier:",
  "    aiCreditAllowance: row.ai_credit_allowance == null ? null : Number(row.ai_credit_allowance),\n    aiCreditPeriod:\n      row.ai_credit_period === 'day'\n        ? 'day'\n        : row.ai_credit_period === 'unlimited'\n          ? 'unlimited'\n          : 'month',\n    captureTier:",
);
await replaceOnce(
  'lib/entitlements.ts',
  "function applyPlans(plans: Partial<Record<'free' | 'pro', PlanLimits>>): void {\n  activeLimits = {\n    free: { ...DEFAULT_PLANS.free, ...(plans.free ?? {}) },\n    pro: { ...DEFAULT_PLANS.pro, ...(plans.pro ?? {}) },\n    owner:",
  "function applyPlans(plans: Partial<Record<'free' | 'pro' | 'max', PlanLimits>>): void {\n  activeLimits = {\n    free: { ...DEFAULT_PLANS.free, ...(plans.free ?? {}) },\n    pro: { ...DEFAULT_PLANS.pro, ...(plans.pro ?? {}) },\n    max: { ...DEFAULT_PLANS.max, ...(plans.max ?? {}) },\n    owner:",
);
await replaceOnce(
  'lib/entitlements.ts',
  "        const plans: Partial<Record<'free' | 'pro', PlanLimits>> = {};\n        for (const r of rows) {\n          if (r.key === 'free' || r.key === 'pro') plans[r.key] = mapRow(r);",
  "        const plans: Partial<Record<'free' | 'pro' | 'max', PlanLimits>> = {};\n        for (const r of rows) {\n          if (r.key === 'free' || r.key === 'pro' || r.key === 'max') plans[r.key] = mapRow(r);",
);

await updateJson('package.json', (pkg) => {
  pkg.version = '8.16.0';
  pkg.scripts['test:ai-selection-816'] = 'node --test scripts/test-ai-selection-816.mjs';
  if (!pkg.scripts.test.includes('test:ai-selection-816')) {
    pkg.scripts.test += ' && npm run test:ai-selection-816';
  }
});
await updateJson('package-lock.json', (lock) => {
  lock.version = '8.16.0';
  lock.packages[''].version = '8.16.0';
});
await replaceOnce('wxt.config.ts', "    version: '8.15.1',", "    version: '8.16.0',");
await replaceOnce('scripts/test-ai-reliability-815.mjs', "assert.equal(pkg.version, '8.15.1');", "assert.equal(pkg.version, '8.16.0');");
await replaceOnce('scripts/test-ai-reliability-815.mjs', "assert.match(settings, /AI helper for selected text only/);", "assert.match(settings, /AiSelectionSettings/);");
await replaceOnce("scripts/test-ai-polish-8151.mjs", "test('release metadata is 8.15.1'", "test('release metadata is 8.16.0'");
await replaceOnce("scripts/test-ai-polish-8151.mjs", "assert.equal(pkg.version, '8.15.1');", "assert.equal(pkg.version, '8.16.0');");
await replaceOnce("scripts/test-ai-polish-8151.mjs", "assert.match(config, /version: '8\\.15\\.1'/);", "assert.match(config, /version: '8\\.16\\.0'/);");
await replaceOnce("scripts/test-ai-polish-8151.mjs", "assert.equal(lock.version, '8.15.1');", "assert.equal(lock.version, '8.16.0');");
await replaceOnce("scripts/test-ai-polish-8151.mjs", "assert.equal(lock.packages[''].version, '8.15.1');", "assert.equal(lock.packages[''].version, '8.16.0');");

await rm('scripts/apply-816-selection-command-center.mjs', { force: true });
await rm('.github/workflows/keepsake-816-selection-command-center.yml', { force: true });
