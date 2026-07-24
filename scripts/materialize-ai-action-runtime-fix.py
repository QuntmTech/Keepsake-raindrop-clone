from pathlib import Path
import json
import re


def replace_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'Expected one replacement for {label}, found {count}')
    return updated


# 1) Keep the selection click inside the browser user gesture. Send the complete
# command to the background immediately instead of awaiting session storage first.
content_path = Path('entrypoints/ai-embed.content.ts')
content = content_path.read_text()
content = content.replace("import { setWriterDraft } from '@/lib/aiWriter';\n", '')
content = replace_once(
    content,
    r"      const runAction = async \(action: ResolvedSelectionAction\) => \{.*?^      \};",
    """      const runAction = async (action: ResolvedSelectionAction) => {
        const selected = current ?? selectedEditable();
        if (!selected?.text) return;
        hideCurrentSelection();

        // Send immediately from the click handler so Chrome still recognizes the
        // user gesture required by sidePanel.open(). The background persists the
        // complete draft after it starts opening the panel.
        const response = (await browser.runtime
          .sendMessage({
            type: 'OPEN_AI_TOOLS',
            text: selected.text,
            action: action.writerAction,
            customInstruction: action.customInstruction ?? '',
            targetLanguage: settings.aiSelectionTranslateLanguage || 'English',
            source: 'embedded',
          })
          .catch((error) => ({ ok: false, error: String(error) }))) as {
          ok?: boolean;
          error?: string;
          surface?: 'sidepanel' | 'tab';
        } | null;

        if (!response?.ok) {
          dismissedFingerprint = '';
          toolbar.style.display = 'inline-flex';
          toolbar.title = response?.error || 'Keepsake could not open the AI workspace.';
        }
      };""",
    'selection action handoff',
    re.S | re.M,
)
content_path.write_text(content)


# 2) Start sidePanel.open before any storage await, preserve the full command,
# and fall back to a normal extension tab instead of swallowing failure.
background_path = Path('entrypoints/background.ts')
background = background_path.read_text()
background = replace_once(
    background,
    r"    case 'OPEN_AI_TOOLS':\n.*?      return \{ ok: true \};",
    """    case 'OPEN_AI_TOOLS': {
      // Start opening first. Chrome requires this call to stay attached to the
      // original user click; awaiting storage before it can make the request fail.
      const panelPromise = openSidePanel(sender?.tab?.id);
      const targetPromise = requestSidepanelTarget('ai');
      const draftPromise = msg.text?.trim()
        ? setWriterDraft({
            input: msg.text.trim().slice(0, 48_000),
            output: '',
            action: msg.action ?? 'improve',
            customInstruction: msg.customInstruction ?? '',
            targetLanguage: msg.targetLanguage ?? 'English',
            selectedPromptId: '',
          })
        : Promise.resolve();

      const [opened] = await Promise.all([panelPromise, targetPromise, draftPromise]);
      if (!opened) {
        await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
        return { ok: true, surface: 'tab' };
      }
      return { ok: true, surface: 'sidepanel' };
    }""",
    'OPEN_AI_TOOLS handler',
    re.S,
)
background = replace_once(
    background,
    r"async function openSidePanel\(tabId\?: number\) \{\n.*?^\}",
    """async function openSidePanel(tabId?: number): Promise<boolean> {
  try {
    let id = tabId;
    if (!id) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      id = tab?.id;
    }
    if (!id || typeof browser.sidePanel?.open !== 'function') return false;
    // @ts-expect-error - sidePanel types vary by @types/chrome version
    await browser.sidePanel.open({ tabId: id });
    return true;
  } catch {
    return false;
  }
}""",
    'openSidePanel result handling',
    re.S | re.M,
)
background_path.write_text(background)


# 3) Explain the actual current AI contract clearly. The client has BYOK today;
# hosted plan credits remain a separate backend implementation.
writer_path = Path('components/AIWriter.tsx')
writer = writer_path.read_text()
writer = replace_once(
    writer,
    r"        \{available === false && \(\n          <div className=\"rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-ink-soft\">\n            <p className=\"font-medium text-ink\">Connect an AI provider</p>\n            <p className=\"mt-1\">Novita is recommended for automatic cost-aware multi-model routing\.</p>\n            \{onOpenSettings && <button className=\"mt-2 font-medium text-brand hover:underline\" onClick=\{onOpenSettings\}>Open AI settings →</button>\}\n          </div>\n        \)\}",
    """        {available === false && (
          <div className=\"rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-ink-soft\">
            <p className=\"font-medium text-ink\">AI connection required</p>
            <p className=\"mt-1\">
              This development build does not bundle a secret AI key. Connect Novita, OpenAI, Anthropic, or Google once to run every AI action.
            </p>
            {onOpenSettings && <button className=\"mt-2 font-medium text-brand hover:underline\" onClick={onOpenSettings}>Connect AI now →</button>}
          </div>
        )}""",
    'AI connection banner',
    re.S,
)
writer_path.write_text(writer)


# 4) Focused regression coverage and normal test-suite registration.
test_path = Path('scripts/test-ai-action-runtime-816.mjs')
test_path.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const embed = readFileSync(new URL('../entrypoints/ai-embed.content.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const writer = readFileSync(new URL('../components/AIWriter.tsx', import.meta.url), 'utf8');

test('selection actions send the complete command immediately', () => {
  assert.doesNotMatch(embed, /import \{ setWriterDraft \}/);
  assert.match(embed, /type: 'OPEN_AI_TOOLS',[\s\S]*text: selected\.text/);
  assert.match(embed, /action: action\.writerAction/);
  assert.match(embed, /customInstruction: action\.customInstruction \?\? ''/);
  assert.match(embed, /targetLanguage: settings\.aiSelectionTranslateLanguage/);
});

test('background opens first and never silently drops the AI workspace', () => {
  const handler = background.slice(background.indexOf("case 'OPEN_AI_TOOLS'"), background.indexOf("case 'OPEN_URL'"));
  assert.ok(handler.indexOf('const panelPromise = openSidePanel') < handler.indexOf('setWriterDraft({'));
  assert.match(handler, /customInstruction: msg\.customInstruction \?\? ''/);
  assert.match(handler, /targetLanguage: msg\.targetLanguage \?\? 'English'/);
  assert.match(handler, /browser\.runtime\.getURL\('\/sidepanel\.html'\)/);
  assert.match(background, /async function openSidePanel\(tabId\?: number\): Promise<boolean>/);
  assert.match(background, /return false;/);
});

test('missing AI setup is clearly explained', () => {
  assert.match(writer, /AI connection required/);
  assert.match(writer, /does not bundle a secret AI key/);
  assert.match(writer, /Connect AI now/);
});
""")

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['scripts']['test:ai-runtime-816'] = 'node --test scripts/test-ai-action-runtime-816.mjs'
if 'npm run test:ai-runtime-816' not in package['scripts']['test']:
    package['scripts']['test'] += ' && npm run test:ai-runtime-816'
package_path.write_text(json.dumps(package, indent=2) + '\n')

print('AI action runtime fix materialized.')
