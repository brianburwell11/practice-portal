/**
 * Band routes live at the top level — practiceportal.app/<route> — the same
 * space as the site's own pages. These names can never be a band's route, so
 * a page added later never collides with a band that got there first.
 * Reserving generously is cheap; taking a name back from a real band isn't.
 *
 * Shared by the server (which refuses them) and the New Band / Edit Band forms
 * (which treat them as taken). Matching is case-insensitive, and anything
 * starting with `.` or `_` is reserved as well — `.well-known` is where
 * certificate authorities and security tools look.
 *
 * Deliberately NOT reserved: every existing band's route, including `dev`.
 * `scripts/verify-access.ts` checks both directions: each path the app serves
 * is on this list, and no current band route is.
 */

/** Paths the app serves today. Must stay reserved. */
export const IN_USE_ROUTES = [
  'api', 'healthz', 'invite', 'admin', 'assets',
  'index.html', 'favicon.ico', 'favicon-192.png', 'apple-touch-icon.png', 'soundtouch-processor.js',
] as const;

const RESERVED = [
  ...IN_USE_ROUTES,

  // Web infrastructure and well-known files
  'robots.txt', 'sitemap', 'sitemap.xml', 'llms.txt', 'og-image.png', 'favicon.svg', 'favicon.png', 'manifest.json',
  'manifest.webmanifest', 'site.webmanifest', 'sw.js', 'service-worker.js', 'ads.txt', 'app-ads.txt',
  'humans.txt', 'security.txt', 'apple-app-site-association',
  'browserconfig.xml', 'crossdomain.xml', 'feed', 'rss', 'atom', 'cdn', 'static', 'public', 'media',
  'files', 'file', 'uploads', 'upload', 'images', 'img', 'fonts', 'css', 'js', 'scripts', 'styles',
  'dist', 'build', 'health', 'status', 'ping', 'metrics', 'debug', 'graphql', 'oauth', 'oauth2',
  'auth', 'callback', 'webhook', 'webhooks', 'cron', 'internal', 'system', 'proxy', 'redirect', 'go',
  'link', 'links', 'l', 's', 'u', 'r', 'v',

  // Accounts and sessions
  'login', 'logout', 'log-in', 'log-out', 'signin', 'signout', 'sign-in', 'sign-out', 'signup',
  'sign-up', 'register', 'join', 'account', 'accounts', 'profile', 'profiles', 'settings',
  'preferences', 'me', 'my', 'you', 'user', 'users', 'member', 'members', 'invites', 'invitation',
  'invitations', 'password', 'forgot-password', 'reset', 'reset-password', 'verify', 'verification',
  'confirm', 'session', 'sessions', 'onboarding', 'welcome', 'dashboard', 'home', 'notifications',
  'inbox', 'messages', 'activity', 'security', 'privacy-settings', '2fa', 'mfa', 'sso',

  // Legal, company, help
  'privacy', 'privacy-policy', 'terms', 'terms-of-service', 'terms-of-use', 'tos', 'legal',
  'cookies', 'cookie-policy', 'gdpr', 'ccpa', 'dmca', 'copyright', 'trademark', 'trademarks',
  'license', 'licenses', 'licensing', 'accessibility', 'acceptable-use', 'about', 'about-us',
  'contact', 'contact-us', 'team', 'careers', 'jobs', 'press', 'brand', 'brand-assets', 'company',
  'blog', 'news', 'changelog', 'updates', 'releases', 'roadmap', 'docs', 'documentation', 'help',
  'support', 'faq', 'faqs', 'guide', 'guides', 'tutorial', 'tutorials', 'learn', 'community',
  'forum', 'forums', 'feedback', 'report', 'abuse', 'trust', 'safety', 'transparency',

  // Money
  'pricing', 'plans', 'plan', 'billing', 'checkout', 'subscribe', 'subscription', 'subscriptions',
  'upgrade', 'pro', 'premium', 'plus', 'payment', 'payments', 'pay', 'invoice', 'invoices',
  'receipt', 'receipts', 'store', 'shop', 'donate', 'sponsor', 'sponsors', 'affiliates', 'partners',
  'enterprise', 'education', 'edu', 'teachers', 'schools',

  // Features this app has or may grow
  'bands', 'band', 'songs', 'song', 'setlists', 'setlist', 'practice', 'library', 'discover',
  'explore', 'search', 'browse', 'trending', 'popular', 'featured', 'new', 'create', 'edit',
  'import', 'export', 'share', 'shared', 'embed', 'widget', 'widgets', 'player', 'play', 'listen',
  'live', 'stream', 'music', 'track', 'tracks', 'stems', 'mixer', 'sheet', 'sheets', 'score',
  'scores', 'lyrics', 'notes', 'tapmap', 'metronome', 'tuner', 'tempo', 'transcribe', 'record',
  'recordings', 'guest', 'guests', 'sub', 'subs', 'org', 'orgs', 'organization', 'organizations',
  'teams', 'studio', 'rehearsal', 'rehearsals', 'gigs', 'gig', 'calendar', 'events', 'event',
  'app', 'apps', 'mobile', 'ios', 'android', 'download', 'downloads', 'desktop', 'extension',
  'integrations', 'developers', 'developer',

  // Names that must never look official or mean something to software
  'practiceportal', 'practice-portal', 'www', 'mail', 'email', 'ftp', 'smtp', 'staging', 'test',
  'testing', 'beta', 'alpha', 'demo', 'sandbox', 'preview', 'previews', 'root', 'null', 'undefined',
  'nan', 'true', 'false', 'index', 'default', 'error', 'errors', '404', '500', 'not-found',
  'maintenance', 'offline', 'official', 'staff', 'moderator', 'mod', 'mods', 'administrator',
  'superuser', 'sudo', 'owner', 'owners', 'manager', 'managers', 'editor', 'editors', 'postmaster',
  'webmaster', 'hostmaster', 'noreply', 'no-reply', 'info', 'hello', 'example', 'anonymous',
];

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED);

/** Every reserved name, lowercase. */
export const RESERVED_ROUTES: ReadonlySet<string> = RESERVED_SET;

/** Whether `route` can't be a band's route. */
export function isReservedRoute(route: string): boolean {
  const r = route.trim().toLowerCase();
  if (!r) return false;
  if (r.startsWith('.') || r.startsWith('_')) return true;
  return RESERVED_SET.has(r);
}
