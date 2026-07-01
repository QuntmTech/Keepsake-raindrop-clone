// Curated "Add to Home" app catalog — popular sites with real brand icons
// (served by Google's favicon service, no bundled assets). Users one-click add
// these as pinned Home tiles, or create a fully custom app.

export interface CatalogApp {
  name: string;
  url: string;
  desc: string;
}

export function appIcon(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
  } catch {
    return '';
  }
}

// Normalize a URL for "already added" checks (host minus www + path minus slash).
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase();
  }
}

export const APP_CATALOG: CatalogApp[] = [
  { name: 'YouTube', url: 'https://www.youtube.com', desc: 'Videos & channels' },
  { name: 'Google', url: 'https://www.google.com', desc: 'Web search' },
  { name: 'Gmail', url: 'https://mail.google.com', desc: 'Email by Google' },
  { name: 'Google Drive', url: 'https://drive.google.com', desc: 'Cloud files & docs' },
  { name: 'Google Docs', url: 'https://docs.google.com', desc: 'Documents' },
  { name: 'Google Sheets', url: 'https://sheets.google.com', desc: 'Spreadsheets' },
  { name: 'Google Calendar', url: 'https://calendar.google.com', desc: 'Schedule & events' },
  { name: 'Google Maps', url: 'https://maps.google.com', desc: 'Maps & navigation' },
  { name: 'Google Photos', url: 'https://photos.google.com', desc: 'Photo storage' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', desc: 'OpenAI assistant' },
  { name: 'Claude', url: 'https://claude.ai', desc: 'Anthropic AI assistant' },
  { name: 'Gemini', url: 'https://gemini.google.com', desc: 'Google AI assistant' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', desc: 'AI answers & search' },
  { name: 'GitHub', url: 'https://github.com', desc: 'Code hosting' },
  { name: 'GitLab', url: 'https://gitlab.com', desc: 'DevOps platform' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', desc: 'Developer Q&A' },
  { name: 'Supabase', url: 'https://supabase.com', desc: 'Postgres backend' },
  { name: 'Vercel', url: 'https://vercel.com', desc: 'Frontend deploys' },
  { name: 'Netlify', url: 'https://www.netlify.com', desc: 'Web deploys' },
  { name: 'Cloudflare', url: 'https://dash.cloudflare.com', desc: 'DNS, CDN & security' },
  { name: 'Figma', url: 'https://www.figma.com', desc: 'Design & prototypes' },
  { name: 'Canva', url: 'https://www.canva.com', desc: 'Easy graphic design' },
  { name: 'Notion', url: 'https://www.notion.so', desc: 'Notes & wikis' },
  { name: 'Dropbox', url: 'https://www.dropbox.com', desc: 'Cloud storage' },
  { name: 'Slack', url: 'https://app.slack.com', desc: 'Team chat' },
  { name: 'Discord', url: 'https://discord.com/app', desc: 'Communities & chat' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', desc: 'Messaging (web)' },
  { name: 'Telegram', url: 'https://web.telegram.org', desc: 'Messaging (web)' },
  { name: 'Zoom', url: 'https://zoom.us', desc: 'Video meetings' },
  { name: 'X (Twitter)', url: 'https://x.com', desc: 'Posts & news' },
  { name: 'Instagram', url: 'https://www.instagram.com', desc: 'Photos & reels' },
  { name: 'TikTok', url: 'https://www.tiktok.com', desc: 'Short videos' },
  { name: 'Facebook', url: 'https://www.facebook.com', desc: 'Social network' },
  { name: 'Reddit', url: 'https://www.reddit.com', desc: 'Forums & communities' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com', desc: 'Professional network' },
  { name: 'Pinterest', url: 'https://www.pinterest.com', desc: 'Ideas & inspiration' },
  { name: 'Twitch', url: 'https://www.twitch.tv', desc: 'Live streaming' },
  { name: 'Netflix', url: 'https://www.netflix.com', desc: 'Movies & shows' },
  { name: 'Spotify', url: 'https://open.spotify.com', desc: 'Music & podcasts' },
  { name: 'Amazon', url: 'https://www.amazon.com', desc: 'Shopping' },
  { name: 'eBay', url: 'https://www.ebay.com', desc: 'Buy & sell' },
  { name: 'Etsy', url: 'https://www.etsy.com', desc: 'Handmade & vintage' },
  { name: 'PayPal', url: 'https://www.paypal.com', desc: 'Payments' },
  { name: 'Stripe', url: 'https://dashboard.stripe.com', desc: 'Payments dashboard' },
  { name: 'Coinbase', url: 'https://www.coinbase.com', desc: 'Crypto exchange' },
  { name: 'Outlook', url: 'https://outlook.live.com', desc: 'Microsoft email' },
  { name: 'Yahoo Mail', url: 'https://mail.yahoo.com', desc: 'Email by Yahoo' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', desc: 'Free encyclopedia' },
];
