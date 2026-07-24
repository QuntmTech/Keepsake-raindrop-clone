// Small URL helper shared by Home and the optional app catalog.
// Keep this module data-free so importing it never pulls suggested-apps.json
// into the new-tab startup bundle.
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase();
  }
}
