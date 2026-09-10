# Deploying GrantLane

## Short answer to "do I need anything besides Vercel?"

**One thing, and it isn't Render.** You need a **Redis store** — Vercel's filesystem is read-only,
so the application store has nowhere to write without it. Upstash has a free tier and Vercel
provisions it in about four clicks.

Everything else is either already deployed or not needed:

| | Needed? | Why |
| --- | --- | --- |
| **Vercel** | yes | The whole app — UI, API routes, the endpoint the enclave calls back into |
| **Redis (Upstash)** | **yes** | Vercel's FS is read-only; without it applications vanish |
| Render / Railway / a VPS | **no** | There is no separate backend. Next.js route handlers are the backend |
| A mainnet deployment | **no** | Arc Testnet is the target. See "About mainnet" below |
| Re-deploying the contract | no | Already live at `0xCd84686B7fCc4bC120c0Bfb5e97a92bb9fbEc994` |
| Hosting the CRE workflow | no | It runs on Chainlink's DON, not your infrastructure |
| Hosting anything for World | no | World ID is a hosted service; you only need the RP keys |

There is one **payoff** to deploying that you don't get locally: the CRE workflow fetches the
evidence bundle over confidential HTTP, and it cannot reach `localhost`. A public URL is what makes
`scoring.evidenceApiBaseUrl` real.

---

## 1. Provision Redis

In the Vercel dashboard: **Storage → Create Database → Upstash Redis**, then connect it to the
project. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically and
`apps/web/lib/kv.ts` picks them up with no code change.

Using Upstash directly instead? Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — both
pairs are supported.

If you skip this, `/applications` shows a loud warning in production and applications are lost on
every cold start.

## 2. Import the project

Vercel → **Add New → Project** → import the repo, then set:

| Setting | Value |
| --- | --- |
| **Root Directory** | `apps/web` |
| Framework | Next.js (auto-detected) |
| Build command | default |

**Root Directory is the one that catches people.** This is a monorepo; without it Vercel builds the
repo root and finds no Next app.

## 3. Environment variables

Add these in **Settings → Environment Variables**. Values come from your local `.env`.

Public — these are compiled into the browser bundle, so put nothing secret here:

```
NEXT_PUBLIC_WORLD_APP_ID
NEXT_PUBLIC_WORLD_ACTION
NEXT_PUBLIC_ARC_CHAIN_ID           5042002
NEXT_PUBLIC_ARC_RPC_URL            https://rpc.testnet.arc.io
NEXT_PUBLIC_GRANT_ESCROW_ADDRESS   0xCd84686B7fCc4bC120c0Bfb5e97a92bb9fbEc994
NEXT_PUBLIC_USDC_ADDRESS           0x3600000000000000000000000000000000000000
NEXT_PUBLIC_GRANTER_ADDRESSES      0x30411b981578Fad62D4D20316Da8936cE61F8509
```

Server-only — never prefix these with `NEXT_PUBLIC_`:

```
WORLD_RP_ID
WORLD_RP_SIGNING_KEY               signs IDKit request contexts
WORLD_DEV_PORTAL_API_KEY
ATTESTOR_PRIVATE_KEY               signs payout attestations AND the verification tickets
ARC_RPC_URL                        https://rpc.testnet.arc.io
GITHUB_TOKEN                       optional; raises the repo-lookup rate limit
```

Optional, once the workflow is deployed:

```
CRE_TRIGGER_URL
CRE_TRIGGER_AUTH
CRE_STATUS_URL
```

> `ATTESTOR_PRIVATE_KEY` is doing two jobs — signing on-chain payout attestations and signing the
> HMAC verification tickets. If you'd rather separate them, set `GRANTLANE_TICKET_SECRET` to any
> random string and the tickets will use that instead.

**Do not set `GRANTLANE_DATA_DIR` on Vercel.** It only makes sense with the local file backend.

## 4. Deploy, then check three things

Once the build is green, open the deployment and confirm:

1. **`/`** renders the landing page.
2. **`/verify`** → *Verify with Selfie Check* produces a QR. If it errors, `WORLD_RP_SIGNING_KEY`
   is wrong or missing.
3. **`/applications`** with a granter wallet connected shows the queue with no "no durable store"
   warning. With any other wallet it shows *Granter access only*.

## 5. Turn on Web Analytics

`@vercel/analytics` is already mounted in the root layout, but it only reports once the feature is
enabled for the project: **Vercel → your project → Analytics → Enable**. Until then the script has
no endpoint to talk to and you will see an empty dashboard.

Nothing to configure in code, and no environment variable. It is cookieless, and dynamic routes are
reported by their pattern (`/grant/[id]`), so no grant or application id leaves the browser. In
local development the package deliberately does not load — it stubs the queue and logs to the
console — so an empty dashboard while running `npm run dev` is expected.

## 6. Point the CRE workflow at the deployment

This is the step that only works once you're public. In
`cre-workflow/grant-evaluation-workflow/config.staging.json`:

```json
"evidenceApiBaseUrl": "https://your-deployment.vercel.app"
```

Then rebuild and re-simulate:

```bash
npm run workflow:build
npm run workflow:broadcast
```

The workflow log should now read *"Evidence bundle fetched from the app server"* rather than
*"Evidence API unreachable"*.

---

## About mainnet

**You don't need one, and I'd advise against it for this.** Concretely:

- **Arc is a testnet here.** `GrantEscrow` is deployed to chain `5042002` and the USDC is testnet
  USDC. Moving to a mainnet means real money against a contract that has had no external audit.
- **CRE deploy access isn't enabled on your org yet** (`cre account access`). Runs currently go
  through the simulator with `--broadcast`, which writes real transactions but is not a deployed
  workflow. Mainnet without a deployed workflow would mean no automatic settlement at all.
- **The escrow's forwarder is currently the mock**, set by `scripts/prepare-payout-demo.sh` so the
  simulator could deliver a report. That is a demo configuration. Anything resembling production
  needs it pointed back at the production KeystoneForwarder:

  ```bash
  cast send $ESCROW 'setForwarderAddress(address)' 0x76c9cf548b4179F8901cda1f8623568b58215E62 \
    --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
  ```

If you did want mainnet later, the order would be: audit the contract → get CRE deploy access and
deploy the workflow properly → switch to the production forwarder → deploy to Arc mainnet → move the
World app from staging to production. Not a same-week job.

---

## Known limits of this deployment

- **The granter allowlist is UI segregation, not authorisation.** `/api/applications` is still
  reachable directly, because the server cannot authenticate a wallet without a signature. The money
  is safe regardless — that is enforced on-chain — but the review queue is readable. Closing it
  means sign-in-with-Ethereum. See `apps/web/lib/access.ts`.
- **One Redis key holds every application.** Fine at grant-round scale, wrong at ten thousand.
- **`scripts/seed-applications.mjs` bypasses the Selfie Check** by minting tickets with the server
  secret. It is a local development tool. Do not run it against a public deployment.
