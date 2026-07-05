import { storage } from 'wxt/utils/storage';

// First-run onboarding state machine.
//   'fresh'     → set by the background on a FRESH install; Home shows the
//                 sign-up form first and runs the guided tour after auth.
//   'home-done' → Home tour finished; the extension dropdown (popup) shows its
//                 own short coach-mark tour the first time it opens.
//   'complete'  → nothing left to show. This is also the fallback, so existing
//                 users who merely update never get nagged.
export type OnboardingStage = 'fresh' | 'home-done' | 'complete';

export const onboardingStage = storage.defineItem<OnboardingStage>('local:onboarding_stage', {
  fallback: 'complete',
});
