from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# Background: hand embedded/context-menu text into Writer before opening the side panel.
replace_once(
    "entrypoints/background.ts",
    "import { requestSidepanelTarget } from '@/lib/sidepanelTarget';\n",
    "import { requestSidepanelTarget } from '@/lib/sidepanelTarget';\nimport { setWriterDraft } from '@/lib/aiWriter';\n",
    "AI Writer draft import",
)
replace_once(
    "entrypoints/background.ts",
    "  browser.contextMenus.onClicked.addListener(async (info, tab) => {\n    if (info.menuItemId === 'save-to-vault' && tab) await saveTab(tab);\n  });",
    "  browser.contextMenus.onClicked.addListener(async (info, tab) => {\n    if (info.menuItemId === 'save-to-vault' && tab) {\n      await saveTab(tab);\n      return;\n    }\n    if ((info.menuItemId === 'ai-rewrite-selection' || info.menuItemId === 'ai-reply-selection') && info.selectionText?.trim()) {\n      await setWriterDraft({\n        input: info.selectionText.trim().slice(0, 48_000),\n        output: '',\n        action: info.menuItemId === 'ai-reply-selection' ? 'reply' : 'improve',\n      });\n      await requestSidepanelTarget('ai');\n      await openSidePanel(tab?.id);\n    }\n  });",
    "context menu click handler",
)
replace_once(
    "entrypoints/background.ts",
    "    case 'OPEN_AI_TOOLS':\n      await requestSidepanelTarget('ai');\n      await openSidePanel(sender?.tab?.id);\n      return { ok: true };",
    "    case 'OPEN_AI_TOOLS':\n      if (msg.text?.trim()) {\n        await setWriterDraft({\n          input: msg.text.trim().slice(0, 48_000),\n          output: '',\n          action: msg.action ?? 'improve',\n        });\n      }\n      await requestSidepanelTarget('ai');\n      await openSidePanel(sender?.tab?.id);\n      return { ok: true };",
    "OPEN_AI_TOOLS handoff",
)
replace_once(
    "entrypoints/background.ts",
    "  browser.contextMenus.create({\n    id: 'save-to-vault',\n    title: 'Save page to Keepsake',\n    contexts: ['page', 'link', 'selection'],\n  });\n}",
    "  browser.contextMenus.create({\n    id: 'save-to-vault',\n    title: 'Save page to Keepsake',\n    contexts: ['page', 'link', 'selection'],\n  });\n  browser.contextMenus.create({\n    id: 'ai-rewrite-selection',\n    title: 'Rewrite selection with Keepsake AI',\n    contexts: ['selection', 'editable'],\n  });\n  browser.contextMenus.create({\n    id: 'ai-reply-selection',\n    title: 'Draft a reply with Keepsake AI',\n    contexts: ['selection'],\n  });\n}",
    "AI context menu definitions",
)

# Settings: swap the old bare API-key block for the full AI Engine control center.
replace_once(
    "components/SettingsPanel.tsx",
    "import { Icon } from './Icon';\n",
    "import { Icon } from './Icon';\nimport { AiEngineSettings } from './AiEngineSettings';\n",
    "AiEngineSettings import",
)
settings_path = Path("components/SettingsPanel.tsx")
settings = settings_path.read_text()
start = settings.index('      <Section\n        title="AI"')
end = settings.index('      <Section\n        title="Ambient Recall"', start)
settings = settings[:start] + '      <AiEngineSettings compact={compact} />\n\n' + settings[end:]
settings_path.write_text(settings)

# Tag each task so Novita Auto mode can make an informed routing decision.
replace_once(
    "lib/ai.ts",
    "import { extractJson, llmComplete } from './llm';\n",
    "import { extractJson, llmComplete } from './llm';\nimport { type LlmTask } from './modelCatalog';\n",
    "LlmTask import",
)
replace_once(
    "lib/ai.ts",
    "  tier: 'fast' | 'smart';\n  system?: string;\n  prompt: string;\n  maxTokens?: number;\n",
    "  tier: 'fast' | 'smart';\n  task?: LlmTask;\n  responseFormat?: 'text' | 'json';\n  system?: string;\n  prompt: string;\n  maxTokens?: number;\n",
    "callModel task fields",
)
replace_once(
    "lib/ai.ts",
    "    tier: 'fast',\n    maxTokens: 200,\n    system:",
    "    tier: 'fast',\n    task: 'filing',\n    responseFormat: 'json',\n    maxTokens: 200,\n    system:",
    "tag routing",
)
replace_once(
    "lib/ai.ts",
    "    tier: 'fast',\n    maxTokens: 220,\n    system:",
    "    tier: 'fast',\n    task: 'filing',\n    maxTokens: 220,\n    system:",
    "summary routing",
)
replace_once(
    "lib/ai.ts",
    "      tier: 'fast',\n      maxTokens: 420,\n      system:",
    "      tier: 'fast',\n      task: 'search',\n      responseFormat: 'json',\n      maxTokens: 420,\n      system:",
    "search routing",
)
replace_once(
    "lib/ai.ts",
    "      tier: 'smart',\n      maxTokens: 1100,\n      system:",
    "      tier: 'smart',\n      task: 'library',\n      responseFormat: 'json',\n      maxTokens: 1100,\n      system:",
    "library routing",
)

Path(__file__).unlink(missing_ok=True)
