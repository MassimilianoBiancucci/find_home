// Samtrygg extractor for browser scans (prompts/browser_scan_site.md).
// Run it with the browser's JavaScript tool on https://www.samtrygg.se/hyra-bostad/stockholm once it is OPEN
// and rendered in the user's browser. It only reads the cards already in the DOM: no requests of its own.
// The page shows only the newest 6 of all listings ("Visa alla" leads to /RentalObject/NewSearch, which robots.txt
// disallows), and the cards carry no published date, so FH_SINCE is not used: new_count == on_page and
// older_reached is always false. Dedupe happens at ingest (external_id = the id in the /object/<id>/ URL).
//
// Output: {page, on_page, new_count, older_reached, total_shown, docs}.
(() => {
  const txt = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim() || null;
  const num = (s) => (s ? Number(String(s).replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.')) || null : null);
  const docs = [...document.querySelectorAll('article.listing-card')].map((c) => {
    const a = c.querySelector('a.listing-card__cta') || c.querySelector('a[href^="/object/"]');
    const href = a?.getAttribute('href') || '';
    const m = href.match(/^\/object\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/?#]+)/);
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
      period: txt(c, '.listing-card__period'),
      tags, badges,
      pets: tags.find((t) => /husdjur/i.test(t)) || null,   // raw badge wording; absent badge is not a "no"
      image: c.querySelector('.listing-card__thumb img')?.getAttribute('src') || null,
      images: [...new Set([...c.querySelectorAll('.listing-card__thumb img')]
        .map((i) => i.getAttribute('src') || i.getAttribute('data-src')).filter(Boolean))],
    };
  }).filter((d) => d.id);
  const shown = (document.body.innerText.match(/Visar\s+(\d+)\s+av\s+(\d+)/) || []);
  return { page: 1, on_page: docs.length, new_count: docs.length, older_reached: false,
           total_shown: shown[2] ? Number(shown[2]) : null, docs };
})()
