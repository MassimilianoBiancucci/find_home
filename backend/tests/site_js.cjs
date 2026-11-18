// Runs a site's browser script (extract.js, detail_extract.js) on a saved page in jsdom and prints its result.
// Usage: node site_js.cjs <script.js> <page.html> <url> [hydrated]   (NODE_PATH must reach jsdom)
// `hydrated` empties self.__next_f after loading, as Next.js does once the page has hydrated.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const [script, page, url, mode] = process.argv.slice(2);
const dom = new JSDOM(fs.readFileSync(page, 'utf8'), {
  url, runScripts: 'dangerously',
  beforeParse(window) { window.__next_f = []; },          // the Next.js bootstrap defines it before the pushes
});
if (mode === 'hydrated') dom.window.__next_f.length = 0;
Promise.resolve(dom.window.eval(fs.readFileSync(script, 'utf8')))
  .then((result) => process.stdout.write(JSON.stringify(result)));
