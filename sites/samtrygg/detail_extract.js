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
(() => {
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

  const amenRows = [...main.querySelectorAll('li.amenity')].filter(outsideCards);
  const pet = amenRows.find((li) => /Husdjur tillåtet/i.test(li.textContent));
  const text = [...main.querySelectorAll('p, span, small, div')].filter((e) => outsideCards(e) && !e.children.length)
    .map((e) => clean(e.textContent)).find((t) => /^inkl\./i.test(t) || /\binkl\.\s/i.test(t) && t.length < 120);
  const offers = ld.offers || {};
  const about = ld.about || {};
  const photos = (Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
  return {
    listing: true, url: location.href,
    availability: offers.availability || null,
    start: offers.availabilityStarts || null, end: offers.availabilityEnds || null,
    price: offers.price != null ? Number(offers.price) : null, price_note: text || null,
    rooms: about.numberOfRooms != null ? Number(about.numberOfRooms) : null,
    size: about.floorSize?.value != null ? Number(about.floorSize.value) : null,
    address: about.address || null, geo: about.geo || null,
    photos, photo_count: photos.length,
    description: ld.description || null,
    amenities: (about.amenityFeature || []).filter((a) => a && a.value !== false).map((a) => a.name),
    facts,
    pets: pet ? (pet.classList.contains('amenity--off') ? 'ask' : 'yes') : null,
    pets_evidence: pet ? clean(pet.textContent) : null,
    date_posted: ld.datePosted || null,
  };
})()
