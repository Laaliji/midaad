/**
 * Highlights are keyed by a normalized page URL, so the same article matches across visits even
 * when it was reached through a tracking link or an in-page anchor.
 */

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'ref_src', 'ref_url', 'spm', 'si', 'cmpid', 'ocid', 'ito', 'mkt_tok', 'vero_id', 'oly_anon_id', 'oly_enc_id',
]);

const TRACKING_PREFIXES = ['utm_', 'hsa_', 'pk_', 'mtm_', 'ga_'];

/** Strip the hash, tracking parameters, default ports and a trailing slash; sort what's left. */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    url.hash = '';
    return url.href;
  }
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase();

  const kept = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    return !TRACKING_PARAMS.has(k) && !TRACKING_PREFIXES.some((p) => k.startsWith(p));
  });
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.href;
}
