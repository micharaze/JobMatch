/**
 * Extract job posting URLs from a raw .eml file.
 *
 * Handles:
 *   - Quoted-printable transfer encoding (=3D → =, soft line breaks)
 *   - HTML entity decoding (&amp; → &)
 *   - Proxy/tracker URL unwrapping (?target=, ?url=, ?redirect=)
 *   - Deduplication and path normalisation
 */

/** Supported domains — must match scraper capabilities. */
const SUPPORTED: Record<string, (pathname: string) => boolean> = {
  'freelancermap.com': (p) => /\/(project|projekt)\//.test(p),
  'freelancermap.de':  (p) => /\/(project|projekt)\//.test(p),
  'gulp.de':           (p) => p.startsWith('/jobs/'),
  'xing.com':          (p) => /-\d+$/.test(p),
  'solcom.de':         (p) => p.startsWith('/de/projektportal/projektangebote/') || p.startsWith('/asp/robots/'),
};

/** Decode quoted-printable encoding: strip soft line breaks, expand =XX escapes. */
function decodeQP(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Decode common HTML entities. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Unwrap tracker/proxy URLs by following common redirect query params.
 * URLSearchParams.get() already decodes percent-encoding once, which is correct
 * for single-encoded proxy targets like ?target=https%3A%2F%2F...
 *
 * Handles chains like:
 *   jobscout.dev/proxy?target= → gulp.de/tracker?project_url= → solcom.de/…
 */
function resolveProxy(url: string, depth = 0): string {
  if (depth >= 8) return url;
  try {
    const u = new URL(url);
    const target =
      u.searchParams.get('target') ??
      u.searchParams.get('project_url') ??
      u.searchParams.get('url') ??
      u.searchParams.get('redirect');
    if (target) {
      return resolveProxy(target, depth + 1);
    }
  } catch { /* ignore */ }
  return url;
}

/** Return true if the URL points to a job posting on a supported scraper platform. */
function isJobPostingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const check = SUPPORTED[host];
    return check !== undefined && check(u.pathname);
  } catch {
    return false;
  }
}

/** Query params that are pure tracking noise — strip them, keep everything else. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'refererNode', 'email',
]);

/**
 * Canonical form: origin + pathname + non-tracking query params, no trailing slash.
 * Tracking params (UTM etc.) are stripped. Functional params (id, mode, …) are kept
 * so that URLs like /asp/robots/detail.aspx?mode=GULP&id=123 remain valid.
 */
function canonicalise(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, '');
  const params = new URLSearchParams(u.searchParams);
  TRACKING_PARAMS.forEach((p) => params.delete(p));
  const query = params.toString();
  return u.origin + path + (query ? `?${query}` : '');
}

/**
 * Extract unique job posting URLs from the raw text of an .eml file.
 * Returns an array of canonical URLs ready to paste into the job URL textarea.
 */
export function parseEmlUrls(emlText: string): string[] {
  const found = new Set<string>();

  // Decode QP so href=3D"..." becomes href="..." and soft line breaks vanish.
  const decoded = decodeQP(emlText);

  const hrefRe = /href=["']([^"'\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(decoded)) !== null) {
    try {
      const raw = decodeEntities(m[1]);
      const resolved = resolveProxy(raw);
      if (isJobPostingUrl(resolved)) {
        found.add(canonicalise(resolved));
      }
    } catch { /* skip */ }
  }

  return [...found];
}
