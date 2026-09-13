import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates the typed ABIs the web app imports from the Foundry artifacts.
 * Run after `forge build` whenever a contract's external surface changes.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  { contract: "GrantEscrow", exportName: "grantEscrowAbi", file: "grantEscrowAbi.ts" },
  { contract: "DisputeRegistry", exportName: "disputeRegistryAbi", file: "disputeRegistryAbi.ts" },
];

for (const { contract, exportName, file } of TARGETS) {
  const artifactPath = join(root, `contracts/out/${contract}.sol/${contract}.json`);
  const outPath = join(root, "apps/web/lib", file);

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (cause) {
    console.error(`Could not read ${artifactPath}. Run \`npm run contracts:build\` first.`);
    console.error(String(cause));
    process.exit(1);
  }

  const banner =
    `// Generated from contracts/out/${contract}.sol/${contract}.json — do not edit by hand.\n` +
    "// Regenerate with: npm run gen:abi (after `npm run contracts:build`).\n\n";

  writeFileSync(outPath, `${banner}export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`);

  const fns = artifact.abi.filter((e) => e.type === "function").length;
  console.log(`Wrote ${outPath} (${artifact.abi.length} ABI entries, ${fns} functions).`);
}
