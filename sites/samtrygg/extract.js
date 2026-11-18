// Samtrygg extractor for browser scans (prompts/browser_scan_site.md).
// Run it with the browser's JavaScript tool on a Samtrygg search page that is OPEN and rendered in the user's
// browser (https://www.samtrygg.se/RentalObject/NewSearch?place=Stockholm&sort=newest&page=N, the scan_urls of
// runs/state/samtrygg.json). It only reads the cards already in the DOM: no requests of its own. Cards carry no
// published date, so FH_SINCE is not used: new_count == on_page and older_reached is always false; duplicates are
// removed at ingest. A page Chrome has translated returns {translated: true} and nothing else: stop the site.
// The listing id is the /object/<id>/ segment of the card's URL (the app re-derives it from `url` when the browser
// tool masks the id).
//
// Output: {page, on_page, new_count, older_reached, total_shown, total_city, last_page, docs}.
// total_shown: the counter's results for this search ("Visar 259 bostäder" / "Visar 68 av 259 bostäder" → 259 / 68);
// last_page: the next-page control "›" is disabled or missing, so this is the last result page.
(() => {
  const root = document.documentElement;
  if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl') || !/^sv/i.test(root.lang || 'sv')) {
    return { translated: true, lang: root.lang || null };
  }
  const txt = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim() || null;
  const num = (s) => (s ? Number(String(s).replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.')) || null : null);
  const docs = [...document.querySelectorAll('article.listing-card, .listing-card')].map((c) => {
    const a = c.matches('a[href*="/object/"]') ? c
      : c.querySelector('a.listing-card__cta') || c.querySelector('a[href*="/object/"]');
    const href = a?.getAttribute('href') || '';
    const m = new URL(href || '/', location.origin).pathname.match(/^\/object\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/?#]+)/);
    const specs = [...c.querySelectorAll('.listing-card__specs span')].map((s) => s.textContent.trim());
    const tags = [...c.querySelectorAll('.listing-card__tags .tag')].map((s) => s.textContent.trim());
    const badges = [...c.querySelectorAll('.listing-card__thumb .badge')].map((s) => s.textContent.trim());
    const size = specs.find((s) => /m²/.test(s));
    const rooms = specs.find((s) => /rok/i.test(s));
    return {
      id: m ? m[1] : null,
      url: href ? new URL(href, location.origin).href : null,
      city: m ? m[2] : null,
      area: txt(c, '.listing-card__area'),
      address: txt(c, '.listing-card__title'),
      rent_sek: num(txt(c, '.listing-card__price')?.replace(/\/mån.*/i, '')),
      size_m2: num(size),
      rooms: num(rooms),
      furnished: specs.some((s) => /^möblerad/i.test(s)) ? true : (specs.some((s) => /^omöblerad/i.test(s)) ? false : null),
      furnishing: specs.find((s) => /möbl|flexibel/i.test(s)) || null,     // the card's word: "Delvis möblerad", "Flexibelt" …
      period: txt(c, '.listing-card__period'),
      tags, badges,
      pets: tags.find((t) => /husdjur/i.test(t)) || null,   // raw badge wording; absent badge is not a "no"
      // photos only: lazy cards keep the URL in data-src; the site's "no image" placeholder is not a photo
      images: [...new Set([...c.querySelectorAll('.listing-card__thumb img')]
        .map((i) => i.getAttribute('src') || i.getAttribute('data-src'))
        .filter((u) => u && /^https?:/.test(u) && !/missing_img/i.test(u)))],
      image: null,
    };
  }).filter((d, i, all) => d.id && all.findIndex((x) => x.id === d.id) === i);   // nested card markup: one doc per listing
  const counter = (document.querySelector('.result-count')?.textContent || '').replace(/\s+/g, ' ');
  const c = counter.match(/Visar\s*([\d\s]+?)\s*(?:av\s*([\d\s]+?)\s*)?bost/i);
  const int = (s) => (s ? Number(s.replace(/\s/g, '')) : null);
  const next = [...document.querySelectorAll('.pagination .pg')].find((p) => p.textContent.trim() === '›');
  const page = Number(new URL(location.href).searchParams.get('page') || 1);
  return { page, on_page: docs.length, new_count: docs.length, older_reached: false,
           total_shown: c ? int(c[1]) : null, total_city: c ? int(c[2] || c[1]) : null,
           last_page: !next || next.matches('.disabled, span'), docs };
})()
