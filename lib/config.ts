// Product configuration.
//
// HOSTED_PB_URL is the PocketBase server every published build talks to by
// default. Setting WXT_PB_URL at build time overrides it (e.g. for staging).
// When a URL is present the extension runs in "hosted" mode: cloud accounts +
// synced storage by default, and the local/URL settings are hidden from users.
export const HOSTED_PB_URL: string =
  import.meta.env.WXT_PB_URL ?? 'https://keepsake-chrome-extension.cloudpod.pro';

export const HOSTED = Boolean(HOSTED_PB_URL);
