// Qasa result-page extractor for agent_browser scans (prompts/browser_scan.md).
// Run it with the browser's JavaScript tool on a Qasa search page that is OPEN in the user's browser
// (https://qasa.com/se/sv/find-home?...&page=N). It only reads the page that is already loaded: no extra
// requests. It returns the listings embedded in the page in compact form; save the `docs` array to a file
// and ingest it with:  scripts/findhome ingest listings -f <file> --parser qasa --source agent_browser
(() => {
  const docs = []; let meta = null;
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || '';
    if (!t.includes('ApolloSSRDataTransport') || !t.includes('homeIndexSearch')) continue;
    let o; try { o = JSON.parse(t.slice(t.indexOf('.push(') + 6, t.lastIndexOf(')')).replace(/:\s*undefined\b/g, ':null')); } catch (e) { continue; }
    for (const v of Object.values(o.rehydrate || {})) {
      const d = v?.data?.homeIndexSearch?.documents;
      if (!d) continue;
      meta = { totalCount: d.totalCount, pagesCount: d.pagesCount, hasNextPage: d.hasNextPage };
      for (const n of d.nodes || []) {
        if (docs.some((x) => x.id === n.id)) continue;
        docs.push({
          id: n.id, title: n.title, homeType: n.homeType, monthlyCost: n.monthlyCost, rent: n.rent,
          tenantBaseFee: n.tenantBaseFee, roomCount: n.roomCount, bedroomCount: n.bedroomCount,
          squareMeters: n.squareMeters, petsAllowed: n.petsAllowed, firstHand: n.firstHand, shared: n.shared,
          furnished: n.furnished, startDate: n.startDate, endDate: n.endDate, platform: n.platform,
          publishedAt: n.publishedAt, householdSize: n.householdSize, smokingAllowed: n.smokingAllowed,
          description: (n.description || '').slice(0, 400),
          location: n.location && { locality: n.location.locality, route: n.location.route,
            streetNumber: n.location.streetNumber, point: n.location.point && { lat: n.location.point.lat, lon: n.location.point.lon } },
          uploads: (n.uploads || []).sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 6)
            .map((u) => ({ order: u.order, type: u.type, url: u.url })),
        });
      }
    }
  }
  const page = Number(new URL(location.href).searchParams.get('page') || 1);
  return { page, ...meta, count: docs.length, docs };
})()
