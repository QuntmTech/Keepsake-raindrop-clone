import './fix-image-editor-pdf.mjs';
import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(relativePath, patches) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  let source = await readFile(url, 'utf8');
  let changed = false;

  for (const { before, after, marker } of patches) {
    if (marker && source.includes(marker)) continue;
    const count = source.split(before).length - 1;
    if (count !== 1) {
      throw new Error(`${relativePath}: expected one patch target, found ${count}: ${before.slice(0, 90)}`);
    }
    source = source.replace(before, after);
    changed = true;
  }

  if (changed) {
    await writeFile(url, source, 'utf8');
    console.log(`Patched ${relativePath}`);
  } else {
    console.log(`${relativePath} already patched`);
  }
}

const quickbarHelpers = `
  function youtubeThumbnail(url: string): string | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      let id = '';
      if (host === 'youtu.be') id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
      else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        id = parsed.searchParams.get('v') ?? '';
        if (!id) {
          const parts = parsed.pathname.split('/').filter(Boolean);
          if (['shorts', 'embed', 'live'].includes(parts[0] ?? '')) id = parts[1] ?? '';
        }
      }
      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? \`https://i.ytimg.com/vi/\${id}/hqdefault.jpg\` : null;
    } catch {
      return null;
    }
  }

  function createBookmarkThumbnail(bookmark: Bookmark | RecallItem): HTMLSpanElement {
    const visual = bookmark as Bookmark;
    const youtube = youtubeThumbnail(bookmark.url);
    const candidates = [...new Set(
      [youtube, visual.cover, visual.screenshot, visual.favicon]
        .filter((value): value is string => Boolean(value)),
    )];
    const wrapper = document.createElement('span');
    wrapper.className = 'result-thumb';
    wrapper.setAttribute('aria-hidden', 'true');

    const seed = bookmark.domain || bookmark.title || bookmark.url;
    let hash = 0;
    for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    wrapper.style.setProperty('--ks-thumb-hue', String(hash % 360));

    const letter = document.createElement('span');
    letter.className = 'result-letter';
    letter.textContent = (bookmark.title || bookmark.domain || '?').trim().charAt(0).toUpperCase() || '?';
    wrapper.appendChild(letter);

    if (candidates.length) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      let index = 0;
      const loadNext = () => {
        const next = candidates[index++];
        if (!next) {
          image.remove();
          return;
        }
        image.src = next;
      };
      image.addEventListener('error', loadNext);
      loadNext();
      wrapper.appendChild(image);
    }

    if (youtube) {
      const play = document.createElement('span');
      play.className = 'result-play';
      play.textContent = '▶';
      wrapper.appendChild(play);
    }

    return wrapper;
  }

`;

await patchFile('lib/quickbar.ts', [
  {
    marker: '.result-thumb {',
    before: `    .result { align-items: flex-start; padding: 9px 10px; }
    .result-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .result-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; font-size: 12px; font-weight: 650; }
    .result-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.48); font-size: 10px; }`,
    after: `    .result { align-items: center; min-height: 52px; padding: 7px 8px; }
    .result-thumb { position: relative; width: 38px; height: 38px; flex: none; overflow: hidden; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; background: hsl(var(--ks-thumb-hue, 220) 42% 29%); color: rgba(255,255,255,.9); font-size: 14px; font-weight: 800; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
    .result-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #252833; }
    .result-letter { position: relative; z-index: 0; }
    .result-play { position: absolute; right: 3px; bottom: 3px; z-index: 2; display: grid; width: 14px; height: 14px; place-items: center; border-radius: 50%; background: rgba(0,0,0,.68); color: #fff; font-size: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
    .result-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .result-title { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: #fff; font-size: 12px; font-weight: 650; line-height: 1.25; }
    .result-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.48); font-size: 10px; }`,
  },
  {
    marker: 'function youtubeThumbnail(',
    before: `  function addBookmarkRows(container: HTMLElement, items: (Bookmark | RecallItem)[], emptyMessage: string) {`,
    after: `${quickbarHelpers}  function addBookmarkRows(container: HTMLElement, items: (Bookmark | RecallItem)[], emptyMessage: string) {`,
  },
  {
    marker: 'row.append(createBookmarkThumbnail(bookmark), copy);',
    before: `      copy.append(title, meta);
      row.appendChild(copy);`,
    after: `      copy.append(title, meta);
      row.append(createBookmarkThumbnail(bookmark), copy);`,
  },
]);

await patchFile('lib/watch.ts', [
  {
    marker: `import { ensureOffscreen } from './embedder';`,
    before: `import { db, findSaveByUrl, getSave, patchSave, type Save, type WatchFrequency, type WatchMode } from './save';`,
    after: `import { db, findSaveByUrl, getSave, patchSave, type Save, type WatchFrequency, type WatchMode } from './save';
import { ensureOffscreen } from './embedder';`,
  },
  {
    marker: 'watchedSaves()\n    .then',
    before: `export function scheduleWatchAlarm(): void {
  browser.alarms.create(WATCH_ALARM, { periodInMinutes: WATCH_WAKE_MINUTES, delayInMinutes: 1 });
}`,
    after: `export function scheduleWatchAlarm(): void {
  watchedSaves()
    .then((items) => {
      if (items.length) {
        browser.alarms.create(WATCH_ALARM, { periodInMinutes: WATCH_WAKE_MINUTES, delayInMinutes: 1 });
      } else {
        browser.alarms.clear(WATCH_ALARM).catch(() => {});
      }
    })
    .catch(() => {});
}`,
  },
  {
    marker: 'first check on the next wake\n  });\n  scheduleWatchAlarm();',
    before: `    s.monitoring.nextCheckAt = Date.now() + 5_000; // first check on the next wake
  });
}`,
    after: `    s.monitoring.nextCheckAt = Date.now() + 5_000; // first check on the next wake
  });
  scheduleWatchAlarm();
}`,
  },
  {
    marker: 's.monitoring.nextCheckAt = undefined;\n  });\n  scheduleWatchAlarm();',
    before: `    s.monitoring.nextCheckAt = undefined;
  });
}`,
    after: `    s.monitoring.nextCheckAt = undefined;
  });
  scheduleWatchAlarm();
}`,
  },
  {
    marker: 'async function probePage(save: Save, prevText?: string): Promise<WatchProbe> {\n  try {\n    await ensureOffscreen();',
    before: `async function probePage(save: Save, prevText?: string): Promise<WatchProbe> {
  try {
    // Deadline belt-and-suspenders`,
    after: `async function probePage(save: Save, prevText?: string): Promise<WatchProbe> {
  try {
    await ensureOffscreen();
    // Deadline belt-and-suspenders`,
  },
]);

await patchFile('entrypoints/background.ts', [
  {
    marker: '// watchTick opens the offscreen parser only when at least one watch is due.',
    before: `    if (alarm.name === WATCH_ALARM) {
      // The watch fetch/parse runs in the offscreen document — make sure it exists.
      await ensureOffscreenDocument().catch(() => {});
      watchTick().catch(() => {});
    }`,
    after: `    if (alarm.name === WATCH_ALARM) {
      // watchTick opens the offscreen parser only when at least one watch is due.
      watchTick().catch(() => {});
    }`,
  },
]);

await patchFile('entrypoints/content.ts', [
  {
    marker: `runAt: 'document_idle'`,
    before: `  runAt: 'document_end',`,
    after: `  runAt: 'document_idle',`,
  },
]);
