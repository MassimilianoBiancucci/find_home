// Samtrygg ad status for the status job (prompts/listing_status.md) and gate E. Run it with the browser's JavaScript
// tool on ONE object page (https://www.samtrygg.se/object/<id>/...) that is OPEN in the user's browser.
//
// Rules (seen on 10 pages, iteration 2, first match wins):
//   1. the page's HTTP code (performance navigation entry) 410 + badge ".gone-summary__badge" "Uthyrd" → rented;
//      410 without it → removed;
//   2. 404 → not_found;
//   3. RealEstateListing JSON-LD offers.availability ends in "InStock" → open (with the current price);
//   4. else unknown, with what was seen.
// Samtrygg never uses a plain 404 for a let ad, so the HTTP code alone is not enough.
//
// Output: {translated: true} on a translated page; else {status, evidence: {rule, value, http, url_final}, price?}.
// With window.FH_POST = {api, site, run, job_run} set (the status job), the result goes straight to the app
// (POST <api>/api/inbox/raw, kind "status") and only the app's short answer comes back.
(async () => {
  const doc = (() => {
    const root = document.documentElement;
    if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
      return { translated: true, lang: root.lang || null };
    }
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    const http = nav.responseStatus || null;
    const base = { http, url_final: location.href };
    const badge = clean(document.querySelector('.gone-summary__badge')?.textContent);
    if (http === 410) {
      return /^uthyrd/i.test(badge)
        ? { status: 'rented', evidence: { ...base, rule: '410 + badge', value: badge } }
        : { status: 'removed', evidence: { ...base, rule: '410', value: badge || null } };
    }
    if (http === 404) return { status: 'not_found', evidence: { ...base, rule: '404', value: clean(document.title) } };
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
      .flatMap((j) => (Array.isArray(j) ? j : j && j['@graph'] ? j['@graph'] : [j]))
      .find((j) => j && j['@type'] === 'RealEstateListing');
    const offer = ld && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);
    const avail = String(offer?.availability || '');
    if (/InStock$/.test(avail)) {
      const price = Number(offer.price);
      return { status: 'open', evidence: { ...base, rule: 'JSON-LD offers.availability', value: avail },
               price: Number.isFinite(price) && price > 0 ? Math.round(price) : null };
    }
    if (badge) {                                     // a gone page served without the 410 (not seen, kept as a guard)
      return { status: /^uthyrd/i.test(badge) ? 'rented' : 'removed', evidence: { ...base, rule: 'badge', value: badge } };
    }
    return { status: 'unknown', evidence: { ...base, rule: 'none matched', value: avail || clean(document.title) } };
  })();
  const P = window.FH_POST;
  if (!P) return doc;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 10000);
  try {
    const res = await fetch(`${P.api}/api/inbox/raw`, { method: 'POST', headers: { 'content-type': 'application/json' },
      signal: stop.signal,
      body: JSON.stringify({ kind: 'status', site: P.site, run: P.run, job_run: P.job_run, url: location.href, doc }) });
    const answer = await res.json().catch(() => ({}));
    return { posted: res.ok, http: res.status, ...answer };
  } catch (e) {
    const error = e && e.name === 'AbortError'
      ? 'no answer from the app in 10 s (Chrome may be asking to allow local network access)' : String(e);
    return { posted: false, error, doc };            // blocked (permission, app down): submit it with the CLI
  } finally {
    clearTimeout(timer);
  }
})()
