// Runs a site's browser script (extract.js, detail_extract.js) on a saved page in jsdom and prints its result.
// Usage: node site_js.cjs <script.js> <page.html> <url>   (NODE_PATH must reach jsdom, e.g. frontend/node_modules)
const fs = require('fs');
const { JSDOM } = require('jsdom');
const [script, page, url] = process.argv.slice(2);
const dom = new JSDOM(fs.readFileSync(page, 'utf8'), {
  url, runScripts: 'dangerously',
  beforeParse(window) { window.__next_f = []; },          // the Next.js bootstrap defines it before the pushes
});
const result = dom.window.eval(fs.readFileSync(script, 'utf8'));
process.stdout.write(JSON.stringify(result));
