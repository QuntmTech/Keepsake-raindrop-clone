import { db, findSaveByUrl, getSave, patchSave, type Save, type WatchFrequency, type WatchMode } from './save';
import { ensureOffscreen } from './embedder';

// Living Bookmarks (Phase 3): saves that act instead of sitting. A
// chrome.alarms master scheduler wakes every 15 minutes, pulls due watches
// from IndexedDB and checks them politely (per-domain serialization, global
// cap, jitter). Fetch + parse happens in the offscreen document (the service
// worker has no DOMParser).
//
// KNOWN LIMITATION (MVP): heavily JS-rendered pages don't parse via plain
// fetch. Those watches are marked jsRendered ("checks on visit") and re-check
// automatically when the user next opens the page.

export const WATCH_ALARM = 'ks-watch-tick';
export const WATCH_WAKE_MINUTES = 15;
const GLOBAL_CAP = 10; // max checks per wake
const FAIL_DEAD_THRESHOLD = 2; // consecutive 404/410 before declaring dead

export const FREQ_MS: Record<WatchFrequency, number> = {
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  daily: 24 * 3_600_000,
  weekly: 7 * 24 * 3_600_000,
};

export interface WatchConfig {
  mode: WatchMode;
  frequency: WatchFrequency;
  selector?: string;
  alertRule?: { type: 'below' | 'any-change'; value?: number };
}

export function scheduleWatchAlarm(): void {
  watchedSaves()
    .then((items) => {
      if (items.length) {
        browser.alarms.create(WATCH_ALARM, { periodInMinutes: WATCH_WAKE_MINUTES, delayInMinutes: 1 });
      } else {
        browser.alarms.clear(WATCH_ALARM).catch(() => {});
      }
    })
    .catch(() => {});
}

export async function startWatch(saveId: string, cfg: WatchConfig): Promise<void> {
  await patchSave(saveId, (s) => {
    s.monitoring.enabled = true;
    s.monitoring.mode = cfg.mode;
    s.monitoring.frequency = cfg.frequency;
    s.monitoring.selector = cfg.selector;
    s.monitoring.alertRule = cfg.alertRule;
    s.monitoring.failCount = 0;
    s.monitoring.nextCheckAt = Date.now() + 5_000; // first check on the next wake
  });
  scheduleWatchAlarm();
}

export async function stopWatch(saveId: string): Promise<void> {
  await patchSave(saveId, (s) => {
    s.monitoring.enabled = false;
    s.monitoring.nextCheckAt = undefined;
  });
  scheduleWatchAlarm();
}

export async function watchedSaves(): Promise<Save[]> {
  return db.saves.filter((s) => s.monitoring.enabled).toArray();
}

// Everything the offscreen parser returns about one fetched page.
export interface WatchProbe {
  ok: boolean;
  httpStatus?: number;
  price?: number;
  priceRaw?: string;
  text?: string; // normalized main text (content mode)
  similarity?: number; // vs previous text, 0..1
  diff?: string; // compact human-readable diff
  selectorValue?: string;
  selectorFound?: boolean;
  inStock?: boolean;
  looksJsRendered?: boolean;
  error?: string;
}

async function probePage(save: Save, prevText?: string): Promise<WatchProbe> {
  try {
    await ensureOffscreen();
    // Deadline belt-and-suspenders on top of the offscreen fetch timeout: a
    // stuck probe must never stall the scheduler.
    const resp = (await Promise.race([
      browser.runtime.sendMessage({
        target: 'ks-offscreen',
        type: 'OFFSCREEN_WATCH_FETCH',
        url: save.url,
        mode: save.monitoring.mode,
        selector: save.monitoring.selector,
        prevText,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 45_000)),
    ])) as WatchProbe & { ok: boolean };
    return resp ?? { ok: false, error: 'no response' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

// Previous normalized page text for content-watches (too big for the Save row).
async function getPrevText(id: string): Promise<string | undefined> {
  return (await db.meta.get(`watchtext:${id}`))?.value as string | undefined;
}
async function setPrevText(id: string, text: string): Promise<void> {
  await db.meta.put({ key: `watchtext:${id}`, value: text.slice(0, 30_000) });
}

function notify(title: string, message: string, url?: string) {
  const id = `ks-watch-${Date.now()}`;
  browser.notifications
    ?.create(id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message: message.slice(0, 300),
      ...(url ? { contextMessage: url.slice(0, 100) } : {}),
    })
    .catch(() => {});
}

// Dead-link self-healing: confirmed-dead pages get a Wayback Machine lookup
// (the only network call Keepsake makes besides your own LLM provider).
async function healDeadLink(save: Save): Promise<void> {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(save.url)}`);
    const data = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
    const wb = data.archived_snapshots?.closest;
    await patchSave(save.id, (s) => {
      s.archive.status = wb?.available && wb.url ? 'healed' : 'dead';
      s.archive.waybackUrl = wb?.available ? wb.url : undefined;
    });
    if (wb?.available && wb.url) {
      notify('Link healed from the archive', `"${save.title}" is dead — Keepsake found a Wayback Machine copy.`, wb.url);
    } else {
      notify('Dead link', `"${save.title}" returns 404 and has no archive copy${save.archive.snapshotRef ? ' — your own snapshot is available' : ''}.`);
    }
  } catch {
    await patchSave(save.id, (s) => {
      s.archive.status = 'dead';
    });
  }
}

// Evaluate one probe result against the watch config; record history + alert.
export async function applyProbe(save: Save, probe: WatchProbe): Promise<void> {
  const m = save.monitoring;
  const now = Date.now();

  // Dead-link detection (any watch doubles as a link checker).
  if (!probe.ok && (probe.httpStatus === 404 || probe.httpStatus === 410)) {
    const fails = (m.failCount ?? 0) + 1;
    await patchSave(save.id, (s) => {
      s.monitoring.failCount = fails;
      s.monitoring.lastCheckedAt = now;
      s.monitoring.nextCheckAt = now + FREQ_MS[m.frequency];
    });
    if (fails >= FAIL_DEAD_THRESHOLD && save.archive.status === 'alive') await healDeadLink(save);
    return;
  }

  if (!probe.ok) {
    // Transient failure: back off one period, keep counting.
    await patchSave(save.id, (s) => {
      s.monitoring.failCount = (s.monitoring.failCount ?? 0) + 1;
      s.monitoring.lastCheckedAt = now;
      s.monitoring.nextCheckAt = now + FREQ_MS[m.frequency];
    });
    return;
  }

  let value: string | undefined;
  let changed = false;
  let alertText: string | undefined;

  if (m.mode === 'price') {
    if (probe.price == null && probe.looksJsRendered) {
      await patchSave(save.id, (s) => {
        s.monitoring.jsRendered = true; // → "checks on visit"
        s.monitoring.lastCheckedAt = now;
        s.monitoring.nextCheckAt = now + FREQ_MS[m.frequency];
      });
      return;
    }
    if (probe.price != null) {
      value = String(probe.price);
      const prev = m.lastValue != null ? Number(m.lastValue) : undefined;
      changed = prev !== undefined && probe.price !== prev;
      const rule = m.alertRule;
      const dropped = prev !== undefined && probe.price < prev;
      // 'below' alerts on entering/moving within the threshold — not on every
      // unchanged check (that would repeat the same notification hourly).
      const belowNow = rule?.type === 'below' && rule.value != null && probe.price <= rule.value;
      const belowBefore = rule?.type === 'below' && rule.value != null && prev !== undefined && prev <= rule.value;
      if (belowNow && (changed || !belowBefore)) {
        alertText = `Price is ${probe.priceRaw ?? probe.price} — at or below your ${rule!.value} alert`;
      } else if ((!rule || rule.type === 'any-change') && dropped) {
        alertText = `Price dropped: ${m.lastValue} → ${probe.priceRaw ?? probe.price}`;
      }
    }
  } else if (m.mode === 'content') {
    if (m.selector && probe.selectorFound) {
      value = probe.selectorValue?.slice(0, 500);
      changed = m.lastValue !== undefined && value !== m.lastValue;
      if (changed) alertText = `Watched section changed on "${save.title}"`;
    } else if (probe.text) {
      const prevText = await getPrevText(save.id);
      value = String(probe.text.length); // content hashy stand-in for history
      changed = prevText !== undefined && (probe.similarity ?? 1) < 0.95;
      if (changed) alertText = `Page content changed on "${save.title}"`;
      await setPrevText(save.id, probe.text);
      if (changed && probe.diff) value = probe.diff.slice(0, 500);
    }
  } else if (m.mode === 'availability') {
    if (probe.inStock != null) {
      value = probe.inStock ? 'in-stock' : 'out-of-stock';
      changed = m.lastValue !== undefined && value !== m.lastValue;
      if (changed && probe.inStock) alertText = `Back in stock: "${save.title}"`;
    }
  }

  await patchSave(save.id, (s) => {
    s.monitoring.failCount = 0;
    s.monitoring.lastCheckedAt = now;
    s.monitoring.nextCheckAt = now + FREQ_MS[m.frequency] * (0.95 + Math.random() * 0.1); // jitter
    if (s.archive.status !== 'alive') s.archive.status = 'alive'; // it answered again
    if (value !== undefined && (changed || s.monitoring.lastValue === undefined)) {
      s.monitoring.history = [...s.monitoring.history, { ts: now, value, note: alertText }].slice(-100);
    }
    if (value !== undefined) s.monitoring.lastValue = value;
  });

  if (alertText) {
    notify(alertText.startsWith('Price') ? '💰 ' + alertText : alertText, save.url, save.url);
    browser.action?.setBadgeText({ text: '!' }).catch(() => {});
    browser.action?.setBadgeBackgroundColor({ color: '#f59e0b' }).catch(() => {});
    setTimeout(() => browser.action?.setBadgeText({ text: '' }).catch(() => {}), 30_000);
  }
}

// One scheduler wake: due watches, ≤1 concurrent fetch per domain (each
// domain's checks run sequentially), ≤GLOBAL_CAP total per wake.
export async function watchTick(): Promise<void> {
  const now = Date.now();
  const due = (await watchedSaves())
    .filter((s) => !s.monitoring.jsRendered && (s.monitoring.nextCheckAt ?? 0) <= now)
    .sort((a, b) => (a.monitoring.nextCheckAt ?? 0) - (b.monitoring.nextCheckAt ?? 0))
    .slice(0, GLOBAL_CAP);
  if (!due.length) return;

  const byDomain = new Map<string, Save[]>();
  for (const s of due) {
    const list = byDomain.get(s.domain) ?? [];
    list.push(s);
    byDomain.set(s.domain, list);
  }

  // Claim every selected watch's slot up front: even if a probe hangs or the
  // worker dies, the same URL can't wedge the scheduler tick after tick.
  await Promise.all(
    due.map((s) =>
      patchSave(s.id, (row) => {
        row.monitoring.nextCheckAt = now + FREQ_MS[row.monitoring.frequency];
      }),
    ),
  );

  // Domains in parallel; within a domain strictly sequential + cooldown.
  await Promise.all(
    [...byDomain.values()].map(async (list) => {
      for (const save of list) {
        const prevText =
          save.monitoring.mode === 'content' && !save.monitoring.selector ? await getPrevText(save.id) : undefined;
        const probe = await probePage(save, prevText);
        await applyProbe(save, probe);
        if (list.length > 1) await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 2_000));
      }
    }),
  );
}

// "Checks on visit" for JS-rendered pages: the user opened a watched page —
// read the value straight out of the live DOM (content-script piggyback).
export async function checkOnVisit(tabId: number, url: string): Promise<void> {
  const save = await findSaveByUrl(url, { homeOnly: 'include' });
  if (!save?.monitoring.enabled || !save.monitoring.jsRendered) return;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      args: [save.monitoring.selector ?? ''],
      func: (selector: string) => {
        const el = selector ? document.querySelector(selector) : null;
        const priceEl =
          el ??
          document.querySelector('[itemprop="price"], [data-price], .price, [class*="price" i]');
        const bodyText = document.body?.innerText ?? '';
        return {
          selectorValue: el?.textContent?.trim().slice(0, 500),
          priceText: priceEl?.textContent?.trim().slice(0, 100),
          inStock: !/out of stock|sold out|currently unavailable/i.test(bodyText),
        };
      },
    });
    const r = res?.result as { selectorValue?: string; priceText?: string; inStock?: boolean } | null;
    if (!r) return;
    const priceMatch = r.priceText?.match(/[\d.,]+/)?.[0];
    const probe: WatchProbe = {
      ok: true,
      price: priceMatch ? Number(priceMatch.replace(/,/g, '')) : undefined,
      priceRaw: r.priceText,
      selectorValue: r.selectorValue,
      selectorFound: r.selectorValue != null,
      inStock: r.inStock,
    };
    const fresh = await getSave(save.id);
    if (fresh) await applyProbe(fresh, probe);
  } catch {
    /* protected page */
  }
}
