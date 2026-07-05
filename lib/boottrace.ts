import { storage } from 'wxt/utils/storage';

// Boot diagnostics for Home. Every open records timestamped milestones; the
// last boots are kept in a small ring buffer you can read from Help →
// Diagnostics. When a boot stalls, the trace shows exactly which step it died
// on — turning "it didn't load" into an actionable report. Overhead: a handful
// of in-memory marks and ONE storage write per boot (at paint or stall).

export interface BootRecord {
  ts: number; // epoch ms, boot start
  version: string;
  status: 'ok' | 'stalled' | 'crashed';
  marks: { name: string; t: number }[]; // ms since script start
}

const bootLog = storage.defineItem<BootRecord[]>('local:boot_log', { fallback: [] });

const marks: { name: string; t: number }[] = [];
const t0 = Date.now();
let finished = false;

export function mark(name: string): void {
  marks.push({ name, t: Math.round(Date.now() - t0) });
}

export async function finishBoot(status: BootRecord['status']): Promise<void> {
  if (finished) return; // first outcome wins (paint beats a late watchdog)
  finished = true;
  mark(status === 'ok' ? 'paint' : status);
  try {
    const log = await bootLog.getValue();
    const rec: BootRecord = {
      ts: t0,
      version: browser.runtime.getManifest().version,
      status,
      marks: [...marks],
    };
    await bootLog.setValue([rec, ...log].slice(0, 15));
  } catch {
    /* diagnostics must never break the app */
  }
}

export async function readBootLog(): Promise<BootRecord[]> {
  return bootLog.getValue();
}

// One line per boot, e.g. "ok 412ms · script:0 mount:181 init:190 ready:264 paint:311"
export function formatBoot(r: BootRecord): string {
  const last = r.marks[r.marks.length - 1];
  const dur = last ? `${last.t}ms` : '?';
  const steps = r.marks.map((m) => `${m.name}:${m.t}`).join(' ');
  return `${new Date(r.ts).toLocaleString()} · v${r.version} · ${r.status.toUpperCase()} ${dur} · ${steps}`;
}
