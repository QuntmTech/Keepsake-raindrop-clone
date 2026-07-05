import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// A guided spotlight tour: dims the page, cuts a hole around the current
// step's target element, and shows a small card explaining it. Steps without
// a `target` (or whose target isn't on screen right now) render as a centered
// card, so the tour never breaks if a piece of UI happens to be hidden.
export interface TourStep {
  target?: string; // CSS selector — omit for a centered "welcome"/"done" card
  title: string;
  body: string;
}

const PAD = 8; // breathing room around the highlighted element
const CARD_W = 336;
const GAP = 14; // spotlight ↔ card distance

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const step = steps[i];

  // Find + track the target element. Re-measure on resize/scroll so the
  // spotlight stays glued to the element.
  useEffect(() => {
    if (!step) return;
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [i, step]);

  // Position the card next to the spotlight (below if it fits, else above),
  // clamped to the viewport. Runs after render so we know the card's height.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      setCardPos({ top: Math.max(12, (vh - ch) / 2), left: Math.max(12, (vw - CARD_W) / 2) });
      return;
    }
    const below = rect.bottom + PAD + GAP;
    const top = below + ch <= vh - 12 ? below : Math.max(12, rect.top - PAD - GAP - ch);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12);
    setCardPos({ top, left });
  }, [rect, i]);

  // Keyboard: Enter/→ next, ← back, Escape ends the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onDone();
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (i + 1 < steps.length) setI(i + 1);
        else onDone();
      }
      if (e.key === 'ArrowLeft') setI(Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, steps.length, onDone]);

  if (!step) return null;
  const last = i === steps.length - 1;
  // Cutout box (target rect + padding). Chromium can't render a huge
  // box-shadow spread reliably, so the dim is four rectangles around the hole.
  const t = rect ? rect.top - PAD : 0;
  const l = rect ? rect.left - PAD : 0;
  const w = rect ? rect.width + PAD * 2 : 0;
  const h = rect ? rect.height + PAD * 2 : 0;
  const dim = 'fixed bg-black/60 transition-all duration-200';

  return (
    <div className="fixed inset-0 z-[2147483646]" role="dialog" aria-label="Guided tour">
      {rect ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, t) }} />
          <div className={dim} style={{ top: Math.max(0, t), left: 0, width: Math.max(0, l), height: h }} />
          <div className={dim} style={{ top: Math.max(0, t), left: l + w, right: 0, height: h }} />
          <div className={dim} style={{ top: t + h, left: 0, right: 0, bottom: 0 }} />
          <div
            className="pointer-events-none fixed rounded-2xl ring-2 ring-brand transition-all duration-200"
            style={{ top: t, left: l, width: w, height: h }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/60" />
      )}

      {/* Click-catcher so the page underneath stays inert during the tour. */}
      <div className="fixed inset-0" onClick={() => {}} />

      <div
        ref={cardRef}
        className="fixed rounded-2xl border border-line bg-surface-raised p-4 shadow-float"
        style={{ width: CARD_W, top: cardPos?.top ?? -9999, left: cardPos?.left ?? -9999 }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
          <button className="btn-ghost -mr-1 -mt-1 px-1.5 py-1 text-xs text-ink-faint" onClick={onDone} title="Skip the tour">
            <Icon name="close" size={14} />
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{step.body}</p>
        <div className="mt-3.5 flex items-center gap-1.5">
          {steps.map((_, n) => (
            <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-brand' : 'w-1.5 bg-ink/15'}`} />
          ))}
          <span className="flex-1" />
          {i > 0 && (
            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button
            className="btn-primary px-3 py-1 text-xs"
            onClick={() => (last ? onDone() : setI(i + 1))}
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
