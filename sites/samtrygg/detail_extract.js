// Samtrygg object page reader for the details job (prompts/listing_details.md) and gate checks.
// Run it with the browser's JavaScript tool on ONE object page (https://www.samtrygg.se/object/<id>/...) that is OPEN
// and rendered in the user's browser. It sends no requests.
//
// Structured data first: the page's RealEstateListing JSON-LD gives the exact start (availabilityStarts; the visible
// FRÅN shows today's date once the start has passed), end, price, address with postcode, coordinates, every photo
// (the visible gallery holds only 5 <img>), the description and the amenities present. The facts block gives floor,
// furnishing and housing type; the amenity row "Husdjur tillåtet" gives pets: ticked = yes, "— saknas" (class
// amenity--off) = the landlord did not tick it, and the site says to ask = "ask".
// The "Liknande (lediga) bostäder" cards below the ad carry their own dates and pet tags: they are never read.
//
// Output: {translated: true} on a page Chrome translated (read nothing); {listing: false, ...} on a page without a
// listing (let, removed: the status job decides); else {listing: true, url, start, end, price, price_note, rooms,
// size, address, geo, photos, photo_count, description, amenities, facts, pets, pets_evidence}.
(async () => {
  const doc = (() => {
  const root = document.documentElement;
  if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
    return { translated: true, lang: root.lang || null };
  }
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
    .flatMap((j) => (Array.isArray(j) ? j : j && j['@graph'] ? j['@graph'] : [j]))
    .find((j) => j && j['@type'] === 'RealEstateListing');
  if (!ld) return { listing: false, url: location.href, title: document.title };

  // the ad's own content: everything outside the similar-listings cards
  const outsideCards = (el) => !el.closest('.listing-card');
  const main = document.querySelector('main') || document.body;

  const LABELS = ['BOENDEFORM', 'MÖBLERING', 'STORLEK', 'RUM', 'VÅNING', 'FRÅN', 'TILL'];
  const facts = {};
  for (const el of main.querySelectorAll('dt, th, span, div, p, small, strong, li')) {
    if (!outsideCards(el) || el.children.length) continue;
    const label = clean(el.textContent).toUpperCase();
    if (!LABELS.includes(label) || facts[label] !== undefined) continue;
    const sib = el.nextElementSibling;
    let value = sib ? clean(sib.textContent) : '';
    if (!value && el.parentElement) value = clean(el.parentElement.textContent).replace(new RegExp('^' + label, 'i'), '').trim();
    if (value) facts[label] = value;
  }

  // the visible amenity rows: "Diskmaskin", "Diskmaskin — saknas" (off), "El — ingår", "El — tillgängligt mot kostnad"
  const amenRows = [...main.querySelectorAll('li.amenity')].filter(outsideCards);
  const pet = amenRows.find((li) => /Husdjur tillåtet/i.test(li.textContent));
  const rows = amenRows.filter((li) => li !== pet).map((li) => {
    const [name, note] = clean(li.textContent).split(/\s+[—–-]\s+/);
    return { name, on: !li.classList.contains('amenity--off'), note: note || null };
  });
  const text = [...main.querySelectorAll('p, span, small, div')].filter((e) => outsideCards(e) && !e.children.length)
    .map((e) => clean(e.textContent)).find((t) => /^inkl\./i.test(t) || /\binkl\.\s/i.test(t) && t.length < 120);
  const h1 = clean(document.querySelector('h1')?.textContent);
  const offers = ld.offers || {};
  const about = ld.about || {};
  const photos = (Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
  return {
    listing: true, url: location.href,
    availability: offers.availability || null,
    start: offers.availabilityStarts || null, end: offers.availabilityEnds || null,
    price: offers.price != null ? Number(offers.price) : null,
    price_note: text ? text.replace(/^.*?(?=inkl\.)/i, '') : null,
    area: h1 && h1.includes(' - ') ? h1.split(' - ')[0] : null,     // "Norrmalm - 3rok - …": the landlord's district label
    rooms: about.numberOfRooms != null ? Number(about.numberOfRooms) : null,
    size: about.floorSize?.value != null ? Number(about.floorSize.value) : null,
    address: about.address || null, geo: about.geo || null,
    photos, photo_count: photos.length,
    description: ld.description || null,
    amenity_rows: rows,
    amenities: rows.length ? rows.filter((r) => r.on && !r.note).map((r) => r.name)
      : (about.amenityFeature || []).filter((a) => a && a.value !== false).map((a) => a.name),
    // included or available at a cost; "ej tillgängligt" and "saknas" are not there
    utilities: rows.filter((r) => r.note && !/^(saknas|ej tillgängligt)$/i.test(r.note)).map((r) => `${r.name} — ${r.note}`),
    facts,
    pets: pet ? (pet.classList.contains('amenity--off') ? 'ask' : 'yes') : null,
    pets_evidence: pet ? clean(pet.textContent) : null,
    date_posted: ld.datePosted || null,
  };
})();
  // With window.FH_POST = {api, site, run, job_run} set (the details job), the result goes straight to the app
  // (POST <api>/api/inbox/raw) and only the app's short answer comes back; without it, the result itself.
  const P = window.FH_POST;
  if (!P) return doc;
  try {
    const res = await fetch(`${P.api}/api/inbox/raw`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'detail', site: P.site, run: P.run, job_run: P.job_run, url: location.href, doc }) });
    const answer = await res.json().catch(() => ({}));
    return { posted: res.ok, http: res.status, ...answer };
  } catch (e) {
    return { posted: false, error: String(e), doc };          // blocked (CSP, app down): post it with the CLI instead
  }
})()
