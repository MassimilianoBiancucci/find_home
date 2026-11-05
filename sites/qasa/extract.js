// Qasa result-page extractor for browser scans (prompts/qasa_browser_scan.md, prompts/browser_scan.md).
// Run it with the browser's JavaScript tool on a Qasa search page that is OPEN in the user's browser
// (https://qasa.com/se/sv/find-home?...&page=N). It only reads the page that is already loaded: no requests.
//
// Optional: set  window.FH_SINCE = "<ISO timestamp>"  first (from runs/state/qasa.json "last_published") to get
// only listings published or bumped after it. Results are newest first, so `older_reached: true` means the
// following pages hold nothing new: stop paging.
//
// Output: {page, totalCount, pagesCount, on_page, new_count, older_reached, docs}. Save it as
// inbox/qasa-<UTC yyyymmddThhmmss>-p<page>.json with "site":"qasa","parser":"qasa","source":"agent_browser" and
// "run":"<run id>" added (prompts/browser_scan_site.md), or ingest it:
// scripts/findhome ingest listings -f <file> --parser qasa --source agent_browser --run <run id>.
(() => {
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
  const docs = fresh.map((n) => ({
    id: n.id, title: n.title, homeType: n.homeType, monthlyCost: n.monthlyCost, rent: n.rent,
    tenantBaseFee: n.tenantBaseFee, roomCount: n.roomCount, bedroomCount: n.bedroomCount,
    squareMeters: n.squareMeters, petsAllowed: n.petsAllowed, firstHand: n.firstHand, shared: n.shared,
    furnished: n.furnished, startDate: n.startDate, endDate: n.endDate, platform: n.platform,
    publishedAt: n.publishedOrBumpedAt || n.publishedAt, householdSize: n.householdSize, smokingAllowed: n.smokingAllowed,
    description: (n.description || '').slice(0, 400),
    location: n.location && { locality: n.location.locality, route: n.location.route,
      streetNumber: n.location.streetNumber, point: n.location.point && { lat: n.location.point.lat, lon: n.location.point.lon } },
    // Every photo and floor plan, in upload order (search results carry the full gallery). Split by type before the
    // cap so a floor plan ordered late is kept; 40 per type keeps the inbox file small.
    uploads: ['home_picture', 'home_layout_picture'].flatMap((type) => (n.uploads || [])
      .filter((u) => u.type === type && u.url).sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, MAX_UPLOADS)
      .map((u) => ({ order: u.order, type: u.type, url: u.url }))),
  }));
  const page = Number(new URL(location.href).searchParams.get('page') || 1);
  return { page, ...meta, on_page: all.length, new_count: docs.length,
           older_reached: since ? fresh.length < all.length : false, docs };
})()
