import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates apps/web/lib/grantEscrowAbi.ts from the Foundry artifact.
 * Run after `forge build` whenever GrantEscrow's external surface changes.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = join(root, "contracts/out/GrantEscrow.sol/GrantEscrow.json");
const outPath = join(root, "apps/web/lib/grantEscrowAbi.ts");

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch (cause) {
  console.error(`Could not read ${artifactPath}. Run \`npm run contracts:build\` first.`);
  console.error(String(cause));
  process.exit(1);
}

const banner =
  "// Generated from contracts/out/GrantEscrow.sol/GrantEscrow.json — do not edit by hand.\n" +
  "// Regenerate with: npm run gen:abi (after `npm run contracts:build`).\n\n";

writeFileSync(outPath, `${banner}export const grantEscrowAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`);

const fns = artifact.abi.filter((e) => e.type === "function").length;
console.log(`Wrote ${outPath} (${artifact.abi.length} ABI entries, ${fns} functions).`);
