from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# Background maintenance happens after first-paint work, not during browser boot.
replace_once(
    "entrypoints/background.ts",
    "const AUTH_REFRESH_ALARM = 'ks-auth-refresh';\nfunction scheduleAuthRefresh(): void {",
    "const AUTH_REFRESH_ALARM = 'ks-auth-refresh';\n"
    "const MAINTENANCE_ALARM = 'ks-maintenance';\n"
    "function scheduleAuthRefresh(): void {",
    "maintenance alarm constant",
)
replace_once(
    "entrypoints/background.ts",
    "function scheduleAuthRefresh(): void {\n  browser.alarms.create(AUTH_REFRESH_ALARM, { periodInMinutes: 720, delayInMinutes: 5 });\n}",
    "function scheduleAuthRefresh(): void {\n"
    "  browser.alarms.create(AUTH_REFRESH_ALARM, { periodInMinutes: 720, delayInMinutes: 5 });\n"
    "}\n"
    "function scheduleMaintenance(): void {\n"
    "  // Chrome startup should paint Home/popup first. Queue recovery, migration,\n"
    "  // and overlay repair are durable maintenance and can safely wait 30s.\n"
    "  browser.alarms.create(MAINTENANCE_ALARM, { delayInMinutes: 0.5 });\n"
    "}",
    "maintenance scheduler",
)
replace_once(
    "entrypoints/background.ts",
    "    await flushQueue().catch(() => {});\n    scheduleQueue();\n    scheduleWatchAlarm();\n    scheduleAuthRefresh();\n    await runMigration();\n    syncHomeOverlay().catch(() => {});",
    "    scheduleQueue();\n"
    "    scheduleWatchAlarm();\n"
    "    scheduleAuthRefresh();\n"
    "    scheduleMaintenance();",
    "deferred install maintenance",
)
replace_once(
    "entrypoints/background.ts",
    "    await flushQueue().catch(() => {});\n    scheduleQueue();\n    scheduleWatchAlarm();\n    scheduleAuthRefresh();\n    await runMigration();\n    syncHomeOverlay().catch(() => {});",
    "    scheduleQueue();\n"
    "    scheduleWatchAlarm();\n"
    "    scheduleAuthRefresh();\n"
    "    scheduleMaintenance();",
    "deferred startup maintenance",
)
replace_once(
    "entrypoints/background.ts",
    "    if (alarm.name === AUTH_REFRESH_ALARM) {\n      // Keep long-lived sessions alive even if the user never opens a surface\n      // (the refresh itself is throttled through storage, so this is cheap).\n      const backend = await getBackend().catch(() => null);\n      await backend?.renewAuthToken?.().catch(() => {});\n    }",
    "    if (alarm.name === AUTH_REFRESH_ALARM) {\n"
    "      // Keep long-lived sessions alive even if the user never opens a surface\n"
    "      // (the refresh itself is throttled through storage, so this is cheap).\n"
    "      const backend = await getBackend().catch(() => null);\n"
    "      await backend?.renewAuthToken?.().catch(() => {});\n"
    "    }\n"
    "    if (alarm.name === MAINTENANCE_ALARM) {\n"
    "      await flushQueue().catch(() => {});\n"
    "      await runMigration().catch(() => {});\n"
    "      await syncHomeOverlay().catch(() => {});\n"
    "    }",
    "maintenance alarm handler",
)

# Coalesce navigation intelligence so SPAs don't hammer local search/watch checks.
replace_once(
    "entrypoints/background.ts",
    "  // ── Ambient Recall (Phase 2) ──────────────────────────────────────────────",
    "  // ── Ambient Recall (Phase 2) ──────────────────────────────────────────────\n"
    "  const pageIntelligenceTimers = new Map<number, ReturnType<typeof setTimeout>>();\n"
    "  const schedulePageIntelligence = (tabId: number, url: string, delay = 450) => {\n"
    "    const previous = pageIntelligenceTimers.get(tabId);\n"
    "    if (previous) clearTimeout(previous);\n"
    "    const timer = setTimeout(() => {\n"
    "      pageIntelligenceTimers.delete(tabId);\n"
    "      runRecall(tabId, url).catch(() => {});\n"
    "      checkOnVisit(tabId, url).catch(() => {});\n"
    "    }, delay);\n"
    "    pageIntelligenceTimers.set(tabId, timer);\n"
    "  };",
    "page intelligence scheduler",
)
replace_once(
    "entrypoints/background.ts",
    "    runRecall(details.tabId, details.url).catch(() => {});\n    // JS-rendered watched pages re-check from the live DOM on visit.\n    checkOnVisit(details.tabId, details.url).catch(() => {});",
    "    schedulePageIntelligence(details.tabId, details.url);",
    "completed navigation intelligence",
)
replace_once(
    "entrypoints/background.ts",
    "    browser.tabs.sendMessage(details.tabId, { type: 'KS_PAGE_NAVIGATED', url: details.url }).catch(() => {});\n    runRecall(details.tabId, details.url).catch(() => {});\n    checkOnVisit(details.tabId, details.url).catch(() => {});",
    "    browser.tabs.sendMessage(details.tabId, { type: 'KS_PAGE_NAVIGATED', url: details.url }).catch(() => {});\n"
    "    schedulePageIntelligence(details.tabId, details.url, 300);",
    "SPA navigation intelligence",
)
replace_once(
    "entrypoints/background.ts",
    "  browser.tabs.onRemoved.addListener((tabId) => {\n    recallCache.getValue()",
    "  browser.tabs.onRemoved.addListener((tabId) => {\n"
    "    const intelligenceTimer = pageIntelligenceTimers.get(tabId);\n"
    "    if (intelligenceTimer) clearTimeout(intelligenceTimer);\n"
    "    pageIntelligenceTimers.delete(tabId);\n"
    "    recallCache.getValue()",
    "tab intelligence cleanup",
)

# Popup paints immediately, then debounces typed queries and vault event bursts.
replace_once(
    "entrypoints/popup/App.tsx",
    "    const timer = setTimeout(run, 20);",
    "    const timer = setTimeout(run, query.trim() ? 120 : 20);",
    "popup adaptive search debounce",
)
replace_once(
    "entrypoints/popup/App.tsx",
    "  useEffect(() => {\n    return watchVault(() => {\n      run();\n      refreshMeta();\n      collectionsApi.refresh();\n    });\n  }, [run, refreshMeta, collectionsApi]);",
    "  useEffect(() => {\n"
    "    let timer: number | undefined;\n"
    "    const unwatch = watchVault(() => {\n"
    "      window.clearTimeout(timer);\n"
    "      timer = window.setTimeout(() => {\n"
    "        run();\n"
    "        refreshMeta();\n"
    "        collectionsApi.refresh();\n"
    "      }, 70);\n"
    "    });\n"
    "    return () => {\n"
    "      window.clearTimeout(timer);\n"
    "      unwatch();\n"
    "    };\n"
    "  }, [run, refreshMeta, collectionsApi.refresh]);",
    "popup vault burst debounce",
)

# Home coalesces storage events from multi-field writes into one repaint.
replace_once(
    "entrypoints/newtab/App.tsx",
    "    const unVault = watchVault(() => {\n      reloadAll();\n      window.setTimeout(reloadTags, 250);\n      c.refresh();\n    });\n    // Pins can also change via the overlay alone (e.g. added from the popup\n    // while this tab is open) — that write never touches the vault stores.\n    const unOverlay = watchHomeOverlay(reloadAll);\n    return () => {\n      unVault();\n      unOverlay();\n    };",
    "    let vaultTimer: number | undefined;\n"
    "    let overlayTimer: number | undefined;\n"
    "    const unVault = watchVault(() => {\n"
    "      window.clearTimeout(vaultTimer);\n"
    "      vaultTimer = window.setTimeout(() => {\n"
    "        reloadAll();\n"
    "        reloadTags();\n"
    "        c.refresh();\n"
    "      }, 80);\n"
    "    });\n"
    "    // Pins can also change via the overlay alone. Coalesce the several storage\n"
    "    // writes from one drag/pin action into one launcher repaint.\n"
    "    const unOverlay = watchHomeOverlay(() => {\n"
    "      window.clearTimeout(overlayTimer);\n"
    "      overlayTimer = window.setTimeout(reloadAll, 60);\n"
    "    });\n"
    "    return () => {\n"
    "      window.clearTimeout(vaultTimer);\n"
    "      window.clearTimeout(overlayTimer);\n"
    "      unVault();\n"
    "      unOverlay();\n"
    "    };",
    "Home vault burst debounce",
)

# Auth state reads can resolve together after the single backend initialization.
replace_once(
    "hooks/useAuth.ts",
    "      await loadAuth();\n      mark('auth');\n      setAuthed(await isLoggedIn());\n      const u = await currentUser();",
    "      await loadAuth();\n"
    "      mark('auth');\n"
    "      const [loggedIn, u] = await Promise.all([isLoggedIn(), currentUser()]);\n"
    "      setAuthed(loggedIn);",
    "parallel auth state reads",
)

Path("scripts/test-startup-polish.mjs").write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const popup = await readFile(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const home = await readFile(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');
const auth = await readFile(new URL('../hooks/useAuth.ts', import.meta.url), 'utf8');

test('browser startup defers durable maintenance behind first paint', () => {
  assert.match(background, /MAINTENANCE_ALARM/);
  assert.match(background, /delayInMinutes: 0\.5/);
  assert.doesNotMatch(background, /onStartup[\s\S]{0,500}await flushQueue/);
});

test('navigation intelligence is coalesced per tab', () => {
  assert.match(background, /pageIntelligenceTimers/);
  assert.match(background, /schedulePageIntelligence/);
  assert.match(background, /clearTimeout\(previous\)/);
});

test('popup and Home debounce storage/query bursts', () => {
  assert.match(popup, /query\.trim\(\) \? 120 : 20/);
  assert.match(popup, /setTimeout\(\(\) => \{[\s\S]*refreshMeta/);
  assert.match(home, /vaultTimer/);
  assert.match(home, /overlayTimer/);
});

test('auth state reads resolve concurrently after initialization', () => {
  assert.match(auth, /Promise\.all\(\[isLoggedIn\(\), currentUser\(\)\]\)/);
});
""")
replace_once(
    "package.json",
    '    "test:reliability": "node --test scripts/test-reliability-safety.mjs",\n    "check:bundle":',
    '    "test:reliability": "node --test scripts/test-reliability-safety.mjs",\n    "test:startup": "node --test scripts/test-startup-polish.mjs",\n    "check:bundle":',
    "startup test script",
)
replace_once(
    "package.json",
    "npm run test:performance && npm run test:reliability\"",
    "npm run test:performance && npm run test:reliability && npm run test:startup\"",
    "startup test chain",
)

Path(__file__).unlink(missing_ok=True)
