// Product configuration.
//
// HOSTED_PB_URL is the PocketBase server every published build talks to by
// default. Setting WXT_PB_URL at build time overrides it (e.g. for staging).
// When a URL is present the extension runs in "hosted" mode: cloud accounts +
// synced storage by default, and the local/URL settings are hidden from users.
export const HOSTED_PB_URL: string =
  import.meta.env.WXT_PB_URL ?? 'https://keepsake-chrome-extension.cloudpod.pro';

export const HOSTED = Boolean(HOSTED_PB_URL);

// ── Stripe billing (Phase 3) ─────────────────────────────────────────────────
//
// These three PocketBase custom-route paths are the CLIENT'S CONTRACT with the
// backend — the exact paths the separate PocketBase-side build implements
// (see /docs/POCKETBASE_BUILD_PROMPT.md). Change them here in ONE place if the
// backend ships different paths; nothing else in the client hardcodes a path.
// PB_WEBHOOK_ROUTE is never called by the client (Stripe calls it directly) —
// it's listed here purely so this file is the single source of truth for all
// three routes.
export const PB_CHECKOUT_ROUTE = '/api/keepsake/create-checkout-session';
export const PB_PORTAL_ROUTE = '/api/keepsake/create-portal-session';
export const PB_WEBHOOK_ROUTE = '/api/keepsake/stripe-webhook'; // reference only — not called from the client

// Stripe PUBLISHABLE keys only (pk_...) — safe for the client bundle. Secret
// keys (sk_...) must NEVER appear here or anywhere in client code; they live
// in PocketBase's server-side env only. Nothing in Phase 3 needs a pk_ (the
// client only opens Stripe-hosted Checkout/Portal URLs the backend creates),
// but the slot is wired now for the Phase 4 admin panel (masked display) and
// any future Stripe.js/Elements use, following the same
// import.meta.env.WXT_* pattern as HOSTED_PB_URL above.
export const STRIPE_PK_TEST: string = import.meta.env.WXT_STRIPE_PK_TEST ?? '';
export const STRIPE_PK_LIVE: string = import.meta.env.WXT_STRIPE_PK_LIVE ?? '';
