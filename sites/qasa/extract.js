// Qasa result-page extractor for browser scans (prompts/qasa_browser_scan.md, prompts/browser_scan.md).
// Run it with the browser's JavaScript tool on a Qasa search page that is OPEN in the user's browser
// (https://qasa.com/se/sv/find-home?...&page=N). It reads the page that is already loaded; its one request, with
// window.FH_POST set, hands the page to your local app (see the end).
//
// Optional: set  window.FH_SINCE = "<ISO timestamp>"  first (from runs/state/qasa.json "last_published") to get
// only listings published or bumped after it. Results are newest first, so `older_reached: true` means the
// following pages hold nothing new: stop paging.
//
// Each doc is the whole search node (every field Qasa sends, without __typename and nulls), so the app decides what
// to keep; uploads are capped per type. A page Chrome has translated returns {translated: true}: stop the site.
//
// Output: {page, totalCount, pagesCount, on_page, new_count, older_reached, last_page, docs}; with window.FH_POST
// set, {posted, page, on_page, last_page, cards, new, updated, duplicates, total} (the app imported the page).
(async () => {
  const doc = (() => {
  const root = document.documentElement;
  if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
    return { translated: true, lang: root.lang || null };
  }
  const MAX_UPLOADS = 40;   // per type (photos, floor plans)
  const since = window.FH_SINCE ? Date.parse(window.FH_SINCE) : null;
  const all = []; let meta = {};
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || '';
    if (!t.includes('ApolloSSRDataTransport') || !t.includes('homeIndexSearch')) continue;
    let o; try { o = JSON.parse(t.slice(t.indexOf('.push(') + 6, t.lastIndexOf(')')).replace(/:\s*undefined\b/g, ':null')); } catch (e) { continue; }
    for (const v of Object.values(o.rehydrate || {})) {
      const d = v?.data?.homeIndexSearch?.documents;
      if (!d) continue;
      meta = { totalCount: d.totalCount, pagesCount: d.pagesCount };
      for (const n of d.nodes || []) if (!all.some((x) => x.id === n.id)) all.push(n);
    }
  }
  const stamp = (n) => Date.parse(n.publishedOrBumpedAt || n.publishedAt || 0);
  const fresh = since ? all.filter((n) => stamp(n) > since) : all;
  // drop __typename and empty values, recursively, so the inbox file stays small
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (k !== '__typename' && x !== null && x !== undefined) o[k] = strip(x);
      return o;
    }
    return v;
  };
  const docs = fresh.map((n) => ({
    ...strip({ ...n, uploads: undefined }),
    // Every photo and floor plan, in upload order (search results carry the full gallery). Split by type before the
    // cap so a floor plan ordered late is kept; 40 per type keeps the inbox file small.
    uploads: ['home_picture', 'home_layout_picture'].flatMap((type) => (n.uploads || [])
      .filter((u) => u.type === type && u.url).sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, MAX_UPLOADS)
      .map((u) => ({ order: u.order, type: u.type, url: u.url }))),
  }));
  const page = Number(new URL(location.href).searchParams.get('page') || 1);
  return { page, ...meta, on_page: all.length, new_count: docs.length, last_page: meta.pagesCount ? page >= meta.pagesCount : null,
           older_reached: since ? fresh.length < all.length : false, docs };
  })();
  const P = window.FH_POST;
  if (!P || doc.translated) return doc;
  // With window.FH_POST = {api, site, run} set (the browser scan), the page goes straight to the app
  // (POST <api>/api/inbox/raw, kind "page") and only its short answer comes back: the docs never pass through the
  // agent's context (a whole page would be cut at the tool's 50 KB limit).
  const brief = { page: doc.page, on_page: doc.on_page, last_page: doc.last_page };
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 20000);
  try {
    const res = await fetch(`${P.api}/api/inbox/raw`, { method: 'POST', headers: { 'content-type': 'application/json' },
      signal: stop.signal, body: JSON.stringify({ kind: 'page', site: P.site, run: P.run, url: location.href, doc }) });
    const answer = await res.json().catch(() => ({}));
    return { posted: res.ok, http: res.status, ...brief, ...answer };
  } catch (e) {
    const error = e && e.name === 'AbortError'
      ? 'no answer from the app in 20 s (Chrome may be asking to allow local network access)' : String(e);
    return { posted: false, error, ...brief };       // no docs: the page is too big to hand over through the agent
  } finally {
    clearTimeout(timer);
  }
})()
