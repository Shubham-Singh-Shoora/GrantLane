# Deploying GrantLane

## What needs hosting

| | Needed? | Why |
| --- | --- | --- |
| **Vercel** | yes | The whole app: UI, API routes, and the evidence pages UMA claims link to |
| **Redis (Upstash)** | **yes** | Vercel's filesystem is read-only; applications and evidence need somewhere to live |
| A separate backend | no | Next.js route handlers are the backend |
| The contracts | no | Already live on Base Sepolia (see the README) |
| The CRE workflow | no | It runs on Chainlink's DON once deployed, not on your infrastructure |
| Anything for World or UMA | no | Both are hosted; you only need the World RP keys |

---

## 1. Provision Redis

Vercel dashboard: **Storage → Create Database → Upstash Redis**, then connect it to the project.
Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and `apps/web/lib/kv.ts` picks them up with
no code change. Using Upstash directly? `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work
too.

Skip this and applications and evidence bundles are lost on every cold start, and the evidence links
inside UMA claims stop resolving.

## 2. Import the project

Vercel → **Add New → Project** → import the repo, then set **Root Directory** to `apps/web`. This is a
monorepo; without that setting Vercel builds the repo root and finds no Next app. Framework and build
command stay on their defaults.

## 3. Environment variables

**Settings → Environment Variables.** Values come from your local `apps/web/.env.local`.

Public (compiled into the browser bundle, so nothing secret):

```
NEXT_PUBLIC_WORLD_APP_ID
NEXT_PUBLIC_WORLD_ACTION
NEXT_PUBLIC_RPC_URL                       https://sepolia.base.org
NEXT_PUBLIC_GRANT_ESCROW_ADDRESS          0x85AC2a3e1EBc0959599025eB6eF36eD34c862840
NEXT_PUBLIC_USDC_ADDRESS                  0x036CbD53842c5426634e7929541eC2318f3dCF7e
NEXT_PUBLIC_SETTLEMENT_RECEIVER_ADDRESS   0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95
NEXT_PUBLIC_GRANTER_ADDRESSES             0x30411b981578Fad62D4D20316Da8936cE61F8509
NEXT_PUBLIC_APP_URL                       https://<your deployment>
```

`NEXT_PUBLIC_APP_URL` matters more than it looks: it's the host written into every evidence link in a
UMA claim. Leave it unset and claims link to whatever host served the request.

Server-only (never prefix these with `NEXT_PUBLIC_`):

```
WORLD_RP_ID
WORLD_RP_SIGNING_KEY          signs IDKit request contexts
WORLD_DEV_PORTAL_API_KEY
ATTESTOR_PRIVATE_KEY          signs claim and payout-wallet attestations, and verification tickets
WORLD_SINGLE_ACTION           optional
GRANTLANE_TICKET_SECRET       optional; separates ticket signing from the attestor key
GITHUB_TOKEN                  optional; raises the repo-lookup rate limit
```

Coming from the Arc version? **Delete** `NEXT_PUBLIC_ARC_CHAIN_ID`, `NEXT_PUBLIC_ARC_RPC_URL`,
`ARC_RPC_URL`, `CRE_TRIGGER_URL`, `CRE_TRIGGER_AUTH` and `CRE_STATUS_URL`. None are read any more.

**Do not set `GRANTLANE_DATA_DIR` on Vercel.** It only applies to the local file store.

## 4. Deploy, then check

1. **`/`** renders the landing page.
2. **`/grants`** lists the grants on the Base Sepolia escrow.
3. **`/verify`** → *Verify with Selfie Check* shows a QR. An error here means `WORLD_RP_SIGNING_KEY` is
   wrong or missing.
4. **`/applications`** with a granter wallet shows the queue and no "no durable store" warning.
5. Claim a milestone, then open its **Read the evidence** link: the page should say the bundle matches
   its hash, and the URL should be your deployment, not localhost.

## 5. Web Analytics

`@vercel/analytics` is mounted in the root layout. Enable it under **your project → Analytics**. It's
cookieless and reports dynamic routes by pattern, so no grant or evidence id leaves the browser.

## 6. Deploy the CRE settlement workflow

Only possible once the org has deploy access (`cre account access`). Then:

```bash
# point the receiver at the production forwarder and the workflow's owner
cast send 0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95 'setForwarderAddress(address)' 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 --rpc-url https://sepolia.base.org --private-key "$DEPLOYER_PRIVATE_KEY"
cast send 0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95 'setExpectedAuthor(address)' <workflow owner> --rpc-url https://sepolia.base.org --private-key "$DEPLOYER_PRIVATE_KEY"
cd cre-workflow && cre workflow deploy ./settlement-workflow --target production-settings
```

Then make a claim and don't press Settle. About a minute after its window closes, the milestone
should read Approved, settled by a transaction you didn't send.

---

## About mainnet

The target would be **Base mainnet**, where UMA's Optimistic Oracle V3 is at
`0x2aBf1Bd76655de80eDb3086114315Eec75AF500c` and disputes go to UMA's real token-holder vote on
Ethereum. There is no sandbox oracle there, so the testnet answer buttons simply wouldn't apply. The
order would be:

1. Get an audit.
2. Pick a real dispute window (48 hours is sensible) and check UMA's minimum bond for USDC.
   `GrantEscrow`'s constructor refuses a bond below it.
3. Deploy the CRE workflow against the production forwarder.
4. Move the World app from staging to production.

---

## Known limits of this deployment

- **The granter allowlist is UI segregation, not authorisation.** See `apps/web/lib/access.ts`.
- **One Redis key holds every application**, and one holds every evidence bundle. Fine at grant-round
  scale.
- **`scripts/seed-applications.mjs` bypasses the Selfie Check** by minting tickets with the server
  secret. It's a local development tool; never run it against a public deployment.
