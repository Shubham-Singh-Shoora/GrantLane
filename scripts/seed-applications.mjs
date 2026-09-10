import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Seeds demo applications so the reviewer flow has something to review.
 *
 * DEVELOPMENT ONLY. This mints verification tickets directly with the server's
 * signing secret, which means it deliberately skips the Selfie Check. That is
 * not a bypass anyone else can use — it needs the secret from your local .env,
 * and whoever holds that already controls the server. Do not deploy anything
 * that does this, and do not expose it as an endpoint.
 *
 *   node scripts/seed-applications.mjs [baseUrl]
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.argv[2] ?? "http://localhost:3000";

function loadEnv() {
  const out = {};
  for (const raw of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.slice(0, line.indexOf("=")).trim();
    let value = line.slice(line.indexOf("=") + 1).trim();
    const hash = value.search(/\s#/);
    if (hash !== -1) value = value.slice(0, hash).trim();
    out[key] = value;
  }
  return out;
}

const env = loadEnv();
const secret = env.GRANTLANE_TICKET_SECRET || env.ATTESTOR_PRIVATE_KEY;
if (!secret) {
  console.error("Set GRANTLANE_TICKET_SECRET or ATTESTOR_PRIVATE_KEY in .env first.");
  process.exit(1);
}

/** Mirrors lib/verifications.ts — same payload shape, same HMAC. */
function mintTicket(purpose, nullifierHash) {
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  const payload = `${purpose}.${nullifierHash}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function nullifier(seed) {
  return `0x${createHmac("sha256", "grantlane-demo").update(seed).digest("hex")}`;
}

const APPLICATIONS = [
  {
    projectName: "Fieldnote",
    organisation: "Fieldnote Collective",
    pitch:
      "Fieldnote is an offline-first notebook for field researchers working where there is no signal — ecologists, epidemiologists, disaster-response teams. Notes, photos and structured observations sync opportunistically and merge without conflicts when a connection appears. This grant funds the sync engine rewrite and a public audit of the conflict-resolution logic, which is the part institutions ask about before they will adopt it.",
    website: "https://example.org/fieldnote",
    repoUrl: "https://github.com/smartcontractkit/cre-cli",
    wallet: "0x30411b981578Fad62D4D20316Da8936cE61F8509",
    proposedMilestones: [
      { title: "Sync engine rewrite", criteria: "merged pull request\ntests covering conflict resolution\nbenchmark against the old engine", amount: "400000" },
      { title: "Independent audit", criteria: "published audit report\nall high findings closed", amount: "350000" },
      { title: "1.0 release", criteria: "tagged release\nmigration guide\ndemo recording", amount: "250000" },
    ],
  },
  {
    projectName: "Threshold",
    organisation: "",
    pitch:
      "Threshold is a small library that makes rate limits legible to the people hitting them. Instead of an opaque 429, it returns a structured budget — what you spent, what is left, when it resets — and ships client helpers that back off correctly against it. This grant funds adapters for the four most common gateways and a conformance suite so the behaviour is testable rather than aspirational.",
    website: "https://example.org/threshold",
    repoUrl: "https://github.com/worldcoin/idkit-js",
    wallet: "0x2B744e2CfE15b8Dc1E4b3d7A3a65CFA3A2386e60",
    proposedMilestones: [
      { title: "Gateway adapters", criteria: "four adapters merged\nintegration tests per adapter", amount: "300000" },
      { title: "Conformance suite", criteria: "public suite\nCI running against each adapter", amount: "200000" },
    ],
  },
];

for (const application of APPLICATIONS) {
  const ticket = mintTicket("application", nullifier(application.projectName));
  const response = await fetch(`${baseUrl}/api/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...application, verificationTicket: ticket }),
  });
  const payload = await response.json().catch(() => ({}));

  if (response.ok) {
    console.log(`✓ ${application.projectName} → ${payload.application.id}`);
  } else if (payload.error === "already_applied") {
    console.log(`· ${application.projectName} already seeded`);
  } else {
    console.log(`✗ ${application.projectName}: ${payload.detail ?? payload.error ?? response.status}`);
  }
}
