/**
 * Renders the HTML documents in this folder to PDFs in docs/.
 *
 *   cd docs/source && npm install && npm run build
 *
 * Uses an installed Chrome or Edge through puppeteer-core (no bundled browser
 * download). Set CHROME_PATH if yours isn't in a standard location.
 *
 * Each page renders its Mermaid diagrams in the browser and sets
 * window.__docReady once every diagram has an SVG. The build waits for that and
 * fails if any diagram didn't render, so a broken diagram can't slip silently
 * into a PDF.
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..");

const DOCS = [
  { source: "architecture.html", output: "GrantLane-Architecture.pdf", title: "Architecture" },
  { source: "project-structure.html", output: "GrantLane-Project-Structure.pdf", title: "Project structure" },
  {
    source: "cre-settlement-workflow.html",
    output: "GrantLane-CRE-Settlement-Workflow.pdf",
    title: "CRE settlement workflow",
  },
];

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const executablePath = CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser executable.");
  process.exit(1);
}

const footer = (title) => `
  <div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#82796a;padding:0 16mm;
              display:flex;justify-content:space-between;">
    <span>GrantLane · ${title}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const doc of DOCS) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    // Lay the page out as it will print — A4 less the side margins is 178 mm, about
    // 673 CSS px — so docs.js sizes diagrams against their real printed height.
    await page.setViewport({ width: 673, height: 1000 });
    await page.emulateMediaType("print");

    await page.goto(pathToFileURL(join(here, doc.source)).href, { waitUntil: "networkidle0", timeout: 120_000 });
    await page.waitForFunction("window.__docReady === true || typeof window.__docError === 'string'", {
      timeout: 120_000,
    });

    const docError = await page.evaluate("window.__docError");
    if (docError) throw new Error(`${doc.source}: ${docError}`);
    if (pageErrors.length) throw new Error(`${doc.source}: page errors:\n${pageErrors.join("\n")}`);

    await page.pdf({
      path: join(outDir, doc.output),
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer(doc.title),
      margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    const diagrams = await page.evaluate("document.querySelectorAll('.mermaid svg').length");
    console.log(`wrote docs/${doc.output} (${diagrams} diagrams)`);
    await page.close();
  }
} finally {
  await browser.close();
}
