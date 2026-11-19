// Qasa ad status for the status job (prompts/listing_status.md) and gate E. Run it with the browser's JavaScript tool
// on ONE listing page (https://qasa.com/se/sv/home/<id>) that is OPEN in the user's browser.
//
// The server answers 200 for every state, so the page state decides (seen on 10 pages, iteration 2 and gate C):
//   1. no Home object and ("home":null in the state, or og:title "Bostaden kunde inte hittas") → not_found;
//   2. Home.status: normal → open (with the monthly cost), archived → removed, rented_out → rented;
//   3. the page's overlay text: "borttagen" → removed, "uthyrd" → rented;
//   4. else unknown, with the raw value. The robots meta is no signal: an open ad can carry "noindex" too.
// The state is Next.js flight data, read from the <script>self.__next_f.push(...)</script> tags (the array empties
// once the page has hydrated); see detail_extract.js.
//
// Output: {translated: true} on a translated page; else {status, evidence: {rule, value, url_final}, price?}.
// With window.FH_POST = {api, site, run, job_run} set (the status job), the result goes straight to the app
// (POST <api>/api/inbox/raw, kind "status") and only the app's short answer comes back.
(async () => {
  const doc = (() => {
    const root = document.documentElement;
    if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
      return { translated: true, lang: root.lang || null };
    }
    const base = { url_final: location.href };
    const id = (location.pathname.match(/\/home\/(\d+)/) || [])[1];
    const fromArray = (self.__next_f || []).map((c) => (Array.isArray(c) && typeof c[1] === 'string' ? c[1] : '')).join('');
    const fromTags = () => [...document.querySelectorAll('script')].map((s) => s.textContent || '')
      .filter((t) => t.startsWith('self.__next_f.push('))
      .map((t) => { try { const a = JSON.parse(t.slice('self.__next_f.push('.length, t.lastIndexOf(')'))); return typeof a[1] === 'string' ? a[1] : ''; } catch { return ''; } })
      .join('');
    const key = `"__typename":"Home","id":"${id}"`;
    const chunks = id && fromArray.includes(key) ? fromArray : fromTags() || fromArray;
    const at = id ? chunks.indexOf(key) : -1;
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    if (at < 0) {
      if (/"home":null/.test(chunks)) return { status: 'not_found', evidence: { ...base, rule: 'state "home":null', value: ogTitle } };
      if (/^Bostaden kunde inte hittas/i.test(ogTitle)) return { status: 'not_found', evidence: { ...base, rule: 'og:title', value: ogTitle } };
      return { status: 'unknown', evidence: { ...base, rule: chunks ? 'no Home object in the page state' : 'no page state', value: ogTitle } };
    }
    // the Home object: back to its "{", forward to the matching "}" (string-aware)
    const begin = chunks.lastIndexOf('{', at);
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = begin; i < chunks.length; i++) {
      const ch = chunks[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = i + 1; break; }
    }
    let h = null;
    try { h = JSON.parse(chunks.slice(begin, end)); } catch { h = null; }
    const block = end > 0 ? chunks.slice(begin, end) : chunks.slice(at, at + 60000);
    const raw = h ? h.status : (block.match(/"status":"(\w+)"/) || [])[1];
    const MAP = { normal: 'open', archived: 'removed', rented_out: 'rented' };
    if (MAP[raw]) {
      const out = { status: MAP[raw], evidence: { ...base, rule: 'Home.status', value: raw } };
      if (MAP[raw] === 'open') {
        const rent = h ? h.rent : Number((block.match(/"rent":(\d+)/) || [])[1]);
        const fee = h ? (h.tenantFees?.base?.cost?.total ?? h.tenantBaseFee ?? 0)
          : Number((block.match(/"tenantBaseFee":(\d+)/) || [])[1] || 0);
        out.price = Number.isFinite(rent) && rent > 0 ? Math.round(rent + (fee || 0)) : null;
      }
      return out;
    }
    const text = (document.querySelector('main') || document.body).innerText || '';
    const overlay = text.match(/Denna bostad är (borttagen|uthyrd)[^\n]*/i);
    if (overlay) {
      return { status: /uthyrd/i.test(overlay[1]) ? 'rented' : 'removed',
               evidence: { ...base, rule: 'overlay text', value: overlay[0].trim() } };
    }
    return { status: 'unknown', evidence: { ...base, rule: 'Home.status not mapped', value: raw ?? null } };
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
