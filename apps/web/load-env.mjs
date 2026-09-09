import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env into process.env.
 *
 * Next.js only reads .env from its own project directory (apps/web), but the
 * repo keeps a single .env at the root so the contracts, the CRE workflow and
 * the web app all read the same values. This bridges the two without a symlink
 * (which needs admin rights on Windows) or a duplicated file that drifts.
 *
 * Values already present in the environment win, so CI and shell overrides
 * still take precedence.
 */

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [join(here, "../../.env"), join(here, ".env")];

/** Minimal dotenv parse: quotes, inline `#` comments, `export` prefixes. */
function parse(source) {
  const out = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;

    let value = withoutExport.slice(eq + 1).trim();

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // Strip an unquoted trailing comment: ` # ...`
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }
  return out;
}

let loadedFrom = null;
for (const path of candidates) {
  if (!existsSync(path)) continue;
  const parsed = parse(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  loadedFrom = path;
  break;
}

export const envPath = loadedFrom;
