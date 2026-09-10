# GrantLane

Milestone-based grant escrow where the review is confidential and the payout is automatic.

A funder escrows USDC against a list of milestones. When a grantee submits evidence, a
**Chainlink CRE** workflow scores it **inside a Nitro TEE** — the reviewer rubric and the raw
submission never leave the enclave — and hands only the verdict back to the DON. The DON signs a
report and writes it to **Arc**, which releases the USDC. Repointing a grant's payout wallet is
gated on a **World ID Selfie Check**.

No human reviewer ever sees the raw submission, and no server key can move escrowed funds.

---

## How the three pieces fit

```
grantee ──submit evidence──► /api/milestones ──HTTP trigger──► CRE workflow
                                   │                               │
                          hash mirrored on-chain          [ Nitro TEE ]
                                   │                       rubric (secret)
                                   ▼                       evidence (confidential HTTP)
                            GrantEscrow.submitEvidence            │ verdict only
                                                                  ▼
                                                            DON consensus
                                                          runtime.report(...)
                                                                  │
grantee ◄──── USDC ──── GrantEscrow._processReport ◄── evmClient.writeReport (Arc)


grantee ──Selfie Check──► /api/verify-selfie ──► World verify API
                                   │
                        EIP-712 attestation (attestor key)
                                   ▼
                    GrantEscrow.changePayoutWallet (grantee sends the tx)
```

Two properties worth calling out:

- **Only a DON-signed report can pay.** `GrantEscrow` inherits `ReceiverTemplate`, which rejects
  any caller that is not the configured `KeystoneForwarder`, and optionally any report from an
  unexpected workflow owner. The server has no path to release funds.
- **The attestor key can redirect a payout but never release one.** It signs an EIP-712 struct that
  the grantee submits themselves; the nullifier is spent on first use, so a replayed Selfie Check
  proof is rejected on-chain.

---

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 14 app — applicant + reviewer UI, and the server routes World requires |
| `contracts` | Foundry project — `GrantEscrow`, `ReceiverTemplate`, deploy script, 20 tests |
| `cre-workflow` | CRE TypeScript workflow — the TEE handler that scores milestones |
| `docs` | The two required hackathon write-ups |
| `scripts/gen-abi.mjs` | Regenerates the typed ABI the web app imports |

---

## Prerequisites

Foundry, Bun, and the CRE CLI are Linux-first; on Windows they run under **WSL**. The npm scripts
already wrap them, so `npm run contracts:test` works from Windows.

```bash
# in WSL
curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
curl -fsSL https://bun.sh/install | bash          # needs `unzip` installed
curl -fsSL https://github.com/smartcontractkit/cre-cli/releases/latest/download/install.sh | bash
```

Verified versions in this repo: Foundry `1.8.1`, Bun `1.4.2`, CRE CLI `v1.32.0` (Arc support needs
CLI ≥ 1.0.7 and TS SDK ≥ 1.3.1 — both clear).

---

## Setup

```bash
cp .env.example .env       # then fill it in
npm install --prefix apps/web
```

Restore the Solidity dependencies (they are gitignored, and `forge install` ran with `--no-git`, so
there is no submodule to restore from):

```bash
wsl -d Ubuntu -- bash -lc 'export PATH=$HOME/.foundry/bin:$PATH; cd contracts && forge install foundry-rs/forge-std --no-git && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git'
```

### Contracts

```bash
npm run contracts:test        # 20 passing
npm run contracts:build
```

Deploy to Arc Testnet (chain `5042002`, RPC `https://rpc.testnet.arc.io`). Fund the deployer from
[faucet.circle.com](https://faucet.circle.com) — **USDC is Arc's native gas token**, so the same
asset pays for gas and fills the escrow.

```bash
wsl -d Ubuntu -- bash -lc 'export PATH=$HOME/.foundry/bin:$PATH; cd contracts && \
  forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast'
```

Then set `NEXT_PUBLIC_GRANT_ESCROW_ADDRESS` and run `npm run gen:abi`.

### Web

```bash
npm run dev        # http://localhost:3000
```

### CRE workflow

```bash
cre login                     # required — init, build and simulate all need auth
npm run workflow:typecheck
npm run workflow:build
npm run workflow:simulate
```

A milestone has been paid end to end on live Arc — TEE scoring, DON report, USDC out of escrow.
The run, with tx hashes and before/after balances, is in
[docs/cre-evidence/live-payout-run.md](docs/cre-evidence/live-payout-run.md).

To repeat it: `scripts/seed-grant.sh` creates a grant, `scripts/prepare-payout-demo.sh` marks a
milestone submitted and points the escrow at the tenant's mock forwarder, then
`npm run workflow:broadcast` runs the workflow for real.

Two things to know before deploying the workflow rather than simulating it:

- **Deployment registry** is `private` for this org. `onchain:ethereum-testnet-sepolia` — what the
  scaffold suggests — is not available; `cre workflow simulate` reports which registries are.
- **Deploy access** is a separate grant (`cre account access`). Until it is enabled, runs go through
  the simulator, which still writes real transactions with `--broadcast`.

---

## Configuration that is easy to get wrong

**World ID 4.x needs a Relying Party, not just an App ID.** `IDKit` requires an `rp_context`
containing an ECDSA signature over the request nonce and validity window, produced by
`@worldcoin/idkit-server`'s `signRequest()`. That means `WORLD_RP_ID` **and** `WORLD_RP_SIGNING_KEY`
in addition to `NEXT_PUBLIC_WORLD_APP_ID`. The browser fetches a fresh context from
`/api/idkit-context` immediately before opening the widget.

**Selfie Check entitlement is server-side, per App ID.** The SDK type still says "currently in preview", but that is stale docstring text — it cannot know your entitlement. Visit `/verify` to find out: a QR means the App ID is enabled, and `credential_unavailable`/`feature_unavailable` means it is not.

**Arc Testnet values**, all verified against live sources:

| | |
| --- | --- |
| Chain ID | `5042002` (`eth_chainId` → `0x4cef52`) |
| RPC | `https://rpc.testnet.arc.io` |
| CRE chain selector | `arc-testnet` → `3034092155422581607` |
| KeystoneForwarder | `0x76c9cf548b4179F8901cda1f8623568b58215E62` |
| Native gas token | USDC at **18 decimals** |
| Escrow ERC-20 (USDC) | `0x3600000000000000000000000000000000000000`, **6 decimals** |
| GrantEscrow (deployed) | `0x85AC2a3e1EBc0959599025eB6eF36eD34c862840` |

Deploy tx `0xd3441328d55241861bcb355424301669306e8cfe7918bd9612b8f1388d9b7697`
(block 61237469, 2,090,602 gas).

### `forge script` cannot send USDC transactions on Arc

Arc's USDC checks a blocklist precompile at `0x1800…0001` on every transfer. It is a *native*
precompile — its bytecode is the stub `0x01` — so Foundry's local REVM cannot execute it and any
`transferFrom` reverts with `StackUnderflow`. Because `forge script` always executes the script
locally to collect the transactions it will broadcast, it fails before sending anything, and
`--skip-simulation` does not change that.

Contract *deployment* is unaffected (`scripts/deploy-arc.sh` uses `forge script` happily). Anything
that moves USDC has to go through `cast send`, which estimates gas on the node where the precompile
is real — see `scripts/seed-grant.sh`. On-chain, `isBlocklisted` returns `false` for both the escrow
and the deployer; the revert is purely a simulation artifact.

> The ERC-20 at `0x3600…0000` mirrors the native USDC balance, so **paying gas reduces the balance
> available to escrow**. Budget for both out of the same funds.

**Two different USDC decimalities coexist, and confusing them is a 10¹² error.** Arc's *native*
gas token is USDC with **18 decimals** (`lib/chain.ts`), while the *escrowed ERC-20* is USDC with
the usual **6 decimals** (`formatUsdc` in `lib/contracts.ts`). Native balances and escrow amounts
must never be formatted with the same helper.

### One `.env`, at the repo root

Next.js only reads `.env` from its own directory, but the contracts and the workflow want the same
values. `apps/web/load-env.mjs` bridges that: `next.config.mjs` imports it, so the root `.env` is
loaded for both `dev` and `build`. It handles inline `# comments`, quotes and `export` prefixes, and
never overrides a variable already set in the environment.

You should see this on startup:

```
[grantlane] loaded env from D:\...\GrantLane\.env
```

---

## Where this repo departs from the original spec

The spec was written against docs that have since moved. These are the corrections, each verified
against the shipped packages rather than assumed:

- **`IDKitWidget` does not exist in `@worldcoin/idkit@4.x`.** The request-mode component is
  `IDKitRequestWidget`, and the credential is selected with a preset. `selfieCheckLegacy()` is
  confirmed exported. This app uses the `useIDKitRequest` hook rather than the widget, so that the
  grant flow and `/verify` share one code path and so refusals surface as their real error code
  instead of a generic message.
- **`rp_context` is required**, which forces the RP signing key and `/api/idkit-context` described
  above. The spec did not mention Relying Party registration at all.
- **Proof verification is `POST /api/v4/verify/{rp_id}` on `developer.world.org`**, and the
  complete IDKit result is forwarded verbatim. There is no `verification_level` field to construct.
- **`ReceiverTemplate.sol` is not an npm package.** Chainlink publishes it as a copy-paste file, so
  `contracts/src/ReceiverTemplate.sol` is an independent implementation of the documented behaviour
  (forwarder check, optional workflow-owner/name gates, abstract `_processReport`). Its metadata
  decoding matches `KeystoneFeedDefaultMetadataLib` from `@chainlink/contracts`.
- **In a TEE handler `runtime.report()` is not available.** `TeeRuntime` exposes `reportFromDon()`
  and `usingTheDons()`; the workflow crosses back to the DON explicitly before signing a report.
- **`cre init` requires authentication.** The `cre-workflow/` tree here is hand-written against the
  SDK's actual types (it typechecks against `@chainlink/cre-sdk@1.20.0`); reconcile it with the
  generated scaffold after `cre login`.

## Known gaps

- **The scoring function is keyword matching, not judgement.** It is deterministic, which the TEE
  requires, but it is a placeholder for a real evaluator. The interesting property being
  demonstrated is *where* the scoring runs, not how clever it is.
- **`lib/store.ts` is in-memory.** Evidence bundles and execution records do not survive a restart
  and are per-isolate on serverless. Chain state is unaffected.
- **CRE execution polling is best-effort.** There is no stable public REST endpoint for reading an
  execution by id, so `/api/execution-status` reconciles against on-chain milestone state and treats
  that as authoritative.
- **The escrow asset is an ERC-20.** On Arc, USDC is also the native gas token; if you want the
  escrow to hold native USDC instead of an ERC-20 representation, `GrantEscrow` needs a native-value
  variant of the transfer paths.
- **The Selfie Check half-loop ends at the QR.** Everything up to and including the connector link is
  verified — signed `rp_context`, an accepted request, a scannable QR. Completing it requires a
  person with World App, so the returned proof has not been round-tripped through
  `/api/verify-selfie` and on into `changePayoutWallet` yet. The contract side of that path is
  covered by tests (valid attestation, forged signature, replayed nullifier, expired deadline).
