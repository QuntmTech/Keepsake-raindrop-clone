import { Icon } from './Icon';

// Shared paywall dialog — shown wherever a Free-plan limit blocks an action.
// Messaging LEADS with what Pro actually unlocks (hosted AI, full Capture
// Studio, more watches) — never with "you hit a cap" as the sales pitch. The
// cap itself is only mentioned as a footnote for context.
//
// Checkout isn't wired yet (Phase 3): the CTA opens the options page, where
// the Account section (SettingsPanel) will host the real "Upgrade to Pro"
// action once Stripe Checkout is connected. This keeps the seam ready without
// building billing UI ahead of schedule.

export type UpgradeReason = 'bookmarks' | 'watches' | 'storage' | 'recording' | 'capture' | 'hosted-ai';

interface Copy {
  title: string;
  body: string;
  footnote?: string;
}

const COPY: Record<UpgradeReason, Copy> = {
  bookmarks: {
    title: 'Go unlimited with Pro',
    body:
      'Pro gets you unlimited cloud bookmarks, plus hosted AI (no API key needed), full Capture Studio, ' +
      'and up to 25 active watches.',
    footnote: 'Your Free plan is capped at 200 cloud bookmarks — everything you already have stays put.',
  },
  watches: {
    title: 'Watch more with Pro',
    body:
      'Pro raises your Living Bookmarks limit to 25 active watches, plus hosted AI and full Capture Studio.',
    footnote: 'Free includes 3 active watches at a time.',
  },
  storage: {
    title: 'More room with Pro',
    body: 'Pro includes 10 GB of cloud storage for screenshots, recordings, and full-page archive copies — 100x Free.',
    footnote: 'Free includes 100 MB of cloud storage.',
  },
  recording: {
    title: 'Sync recordings with Pro',
    body:
      'Pro saves your screen recordings straight to your library and syncs them across devices, with 10 GB of storage. ' +
      'On Free, recordings still download to your computer — they just aren’t synced to the cloud.',
  },
  capture: {
    title: 'Unlock full Capture Studio',
    body:
      'Pro unlocks full-page capture, the annotation/crop editor, and permanent MHTML archive copies of any page ' +
      '— plus hosted AI and more watches.',
    footnote: 'Free includes single-area screenshots.',
  },
  'hosted-ai': {
    title: 'Turn on hosted AI',
    body:
      'Pro includes hosted AI — auto-tagging, summaries, auto-filing, and Ask Your Library with no API key required. ' +
      'Bring-your-own-key AI stays free on every plan.',
  },
};

export function UpgradeDialog({ reason, onClose }: { reason: UpgradeReason; onClose: () => void }) {
  const copy = COPY[reason];

  function seePlans() {
    browser.runtime.openOptionsPage();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div className="card w-full max-w-sm p-5 animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Icon name="sparkles" size={20} />
          </span>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <h3 className="text-base font-semibold text-ink">{copy.title}</h3>
        <p className="mt-1.5 text-sm text-ink-soft">{copy.body}</p>
        {copy.footnote && <p className="mt-2 text-xs text-ink-faint">{copy.footnote}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Not now
          </button>
          <button className="btn-primary flex-1" onClick={seePlans}>
            See Pro plans
          </button>
        </div>
      </div>
    </div>
  );
}
