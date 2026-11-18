// Qasa listing page reader for the details job (prompts/listing_details.md), the status job and gate checks.
// Run it with the browser's JavaScript tool on ONE listing page (https://qasa.com/se/sv/home/<id>) that is OPEN in
// the user's browser. It sends no requests.
//
// The page state is Next.js flight data: self.__next_f holds string chunks; the listing is the object that starts
// with "__typename":"Home","id":"<id>". It is cut out by brace matching and parsed as JSON; if that fails, the
// fields are read one by one. A missing Home object is a missing ad (the server still answers 200).
//
// Output: {translated: true} on a page Chrome translated; {listing: false, status: 'not_found'} without a Home object;
// else {listing: true, id, url, status, floor, buildingFloors, buildYear, bedroomCount, roomCount, squareMeters,
// rent, tenantBaseFee, furnished, duration: {startOptimal, endOptimal, endUfn, startAsap, possibilityOfExtension},
// traits, landlord_professional, location: {latitude, longitude, route, streetNumber, locality, postalCode},
// description, photos, plan_photos, homeTemplates}.
(() => {
  const root = document.documentElement;
  if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
    return { translated: true, lang: root.lang || null };
  }
  const id = (location.pathname.match(/\/home\/(\d+)/) || [])[1];
  const chunks = (self.__next_f || []).map((c) => (Array.isArray(c) && typeof c[1] === 'string' ? c[1] : '')).join('');
  const key = `"__typename":"Home","id":"${id}"`;
  const at = id ? chunks.indexOf(key) : -1;
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
  if (at < 0) return { listing: false, status: 'not_found', url: location.href, og_title: ogTitle };

  // the object around the key: back to its "{", forward to the matching "}" (string-aware)
  const begin = chunks.lastIndexOf('{', at);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = begin; i < chunks.length; i++) {
    const ch = chunks[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i + 1; break; }
  }
  let home = null;
  try { home = JSON.parse(chunks.slice(begin, end)); } catch { home = null; }

  const block = end > 0 ? chunks.slice(begin, end) : chunks.slice(at, at + 60000);
  const num = (k) => { const m = block.match(new RegExp(`"${k}":(-?\\d+(?:\\.\\d+)?)`)); return m ? Number(m[1]) : null; };
  const bool = (k) => { const m = block.match(new RegExp(`"${k}":(true|false)`)); return m ? m[1] === 'true' : null; };
  const str = (k) => { const m = block.match(new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.)*)"`)); try { return m ? JSON.parse(`"${m[1]}"`) : null; } catch { return null; } };
  const h = home || {};
  const pick = (k, f) => (h[k] !== undefined ? h[k] : f(k));
  const dur = h.duration || {};
  const loc = h.location || {};
  const uploads = (h.uploads || []).filter((u) => u && u.url);
  const traits = (h.traits || []).map((t) => t && t.type).filter(Boolean);
  return {
    listing: true, id, url: location.href, parsed_as_json: !!home,
    status: pick('status', str),
    floor: pick('floor', num), buildingFloors: pick('buildingFloors', num), buildYear: pick('buildYear', num),
    bedroomCount: pick('bedroomCount', num), roomCount: pick('roomCount', num), squareMeters: pick('squareMeters', num),
    rent: pick('rent', num), tenantBaseFee: pick('tenantBaseFee', num), furnished: pick('furnished', bool),
    duration: home ? { startOptimal: dur.startOptimal ?? null, endOptimal: dur.endOptimal ?? null, endUfn: dur.endUfn ?? null,
      startAsap: dur.startAsap ?? null, possibilityOfExtension: dur.possibilityOfExtension ?? null }
      : { startOptimal: str('startOptimal'), endOptimal: str('endOptimal'), endUfn: bool('endUfn'),
          startAsap: bool('startAsap'), possibilityOfExtension: bool('possibilityOfExtension') },
    traits: home ? traits : [...new Set([...block.matchAll(/"__typename":"Trait","id":"\d+","detail":(?:null|"[^"]*"),"type":"(\w+)"/g)].map((m) => m[1]))],
    landlord_professional: h.landlord ? h.landlord.professional ?? null : bool('professional'),
    location: home ? { latitude: loc.latitude ?? null, longitude: loc.longitude ?? null, route: loc.route ?? null,
      streetNumber: loc.streetNumber ?? null, locality: loc.locality ?? null, postalCode: loc.postalCode ?? null }
      : { latitude: num('latitude'), longitude: num('longitude') },
    description: pick('description', str),
    photos: uploads.filter((u) => u.type === 'home_picture').sort((a, b) => (a.order || 0) - (b.order || 0)).map((u) => u.url),
    plan_photos: uploads.filter((u) => u.type === 'home_layout_picture').map((u) => u.url),
    homeTemplates: (h.homeTemplates || []).length ? h.homeTemplates : undefined,
  };
})()
