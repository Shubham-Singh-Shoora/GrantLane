# GrantLane

Milestone grant escrow where a claim has to survive a challenge before it pays.

A granter escrows USDC against a list of milestones. When a milestone is done, the grantee publishes
their evidence and claims it on **UMA's Optimistic Oracle** with a USDC bond. The claim is open to
dispute for a set window. If nobody disputes it, it pays out. If someone does, UMA decides, and
whoever was wrong loses their bond. Applying, claiming and changing the payout wallet are each gated
on a **World ID Selfie Check**. Settlement is open to anyone, and a **Chainlink CRE** workflow is built
to do it on a schedule.

Nobody approves a milestone by hand, and no key can release escrowed funds.

Everything runs on **Base Sepolia**. Every step has been done live; the transactions are in
[docs/base-sepolia-evidence.md](docs/base-sepolia-evidence.md).

---

## Why claims and disputes, not scoring

The first version scored milestone evidence inside a Chainlink CRE enclave. The scorer was keyword
matching, and replacing it with something smarter doesn't fix the real problem: nothing automated
can tell whether work is actually *good*. So GrantLane stopped pretending to judge. It makes lying
expensive instead. A claim costs a bond, the evidence is public, and anyone who thinks the claim is
false can take the bond by proving it on UMA.

## How it works

```
applicant ──Selfie Check──► /api/verify-selfie ──► signed ticket
    │
    ├─ evidence + ticket ──► /api/milestones ──► stores the bundle at /evidence/<hash>
    │                                          └► signs a MilestoneClaim (attestor key)
    │
    └─ 1 USDC bond ──► GrantEscrow.submitMilestone ──► UMA OOv3.assertTruth (5-minute window)
                                                              │
       grantor, or anyone ── disputeAssertion + 1 USDC ───────┤
                                                              │
       undisputed ─► window closes ─► settle (anyone, or the CRE workflow)
       disputed    ─► UMA answers  ─► settle
                                                              │
                                     assertionResolvedCallback(true | false)
                                                              │
       payout wallet ◄── withdraw() ◄── credited  (false: milestone reopens)
```

What the contract enforces:

- **Only UMA can resolve a claim.** The callbacks accept calls from the oracle and nothing else, and
  ignore assertions GrantEscrow didn't make.
- **Funds can't be locked by a failed transfer.** Approved milestones are credited and withdrawn
  (pull payment), so settlement never depends on a transfer succeeding.
- **Settlement is permissionless.** `settle()` and `performUpkeep()` can be called by anyone once a
  window closes; `performUpkeep` re-checks every id, so bad input can't do harm.
- **The grantor can't pull the money out from under a claim.** `closeGrant` is blocked while any
  claim is live or disputed.
- **Terms can't be rewritten afterwards.** `createGrant` commits a hash of the milestone terms, and
  every claim quotes it.
- **The attestor key can authorise, never pay.** It signs Selfie Check attestations for claims and
  payout-wallet changes. A claim it signs still needs the bond and still faces the dispute window.

## What's live on Base Sepolia

| | Address |
| --- | --- |
| GrantEscrow | [`0x85AC2a3e1EBc0959599025eB6eF36eD34c862840`](https://sepolia.basescan.org/address/0x85AC2a3e1EBc0959599025eB6eF36eD34c862840) |
| SettlementReceiver (CRE) | [`0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95`](https://sepolia.basescan.org/address/0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95) |
| UMA Optimistic Oracle V3 | `0x0F7fC5E6482f096380db6158f978167b57388deE` |
| UMA sandbox oracle (testnet disputes) | `0x54e38A62ED3dC88e2B80cBA50deB940580511D26` |
| USDC (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Dispute window · bond | 300 s (demo; 48 h in real use) · 1 USDC |

---

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 14 app: applicant, granter and evidence pages, plus the server routes World requires |
| `contracts/src/GrantEscrow.sol` | The escrow: UMA assertions, callbacks, settlement, withdraw, Selfie Check gates |
| `contracts/src/automation` | `SettlementReceiver`, which a CRE report reaches `performUpkeep` through |
| `contracts/test` | 45 unit tests on a mock UMA, 8 receiver tests, 7 fork tests on real UMA and USDC |
| `contracts/script` | `Deploy`, `DeploySettlementReceiver`, and `Demo` (drive a live escrow step by step) |
| `cre-workflow/settlement-workflow` | Cron workflow: reads `checkUpkeep`, reports `performData` |
| `docs` | Live-run evidence, the demo script, World feedback, and the retired CRE scoring evidence |

---

## Prerequisites

Foundry, Bun and the CRE CLI are Linux-first; on Windows they run under **WSL**. The npm scripts wrap
them, so `npm run contracts:test` works from Windows. Verified versions: Foundry `1.8.1`, Bun
`1.4.2`, CRE CLI `v1.32.0`, `@chainlink/cre-sdk` `1.20`.

```bash
# in WSL
curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
curl -fsSL https://bun.sh/install | bash          # needs `unzip`
curl -fsSL https://github.com/smartcontractkit/cre-cli/releases/latest/download/install.sh | bash
```

## Setup

```bash
cp .env.example .env                 # Foundry and demo tooling
cp .env.example apps/web/.env.local  # then keep only the [web] values
npm install --prefix apps/web
```

Restore the Solidity dependencies (gitignored, installed with `--no-git`):

```bash
wsl -d Ubuntu -- bash -lc 'export PATH=$HOME/.foundry/bin:$PATH; cd contracts && forge install foundry-rs/forge-std --no-git && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git'
```

### Contracts

```bash
npm run contracts:test               # unit + receiver tests; fork tests skip without an RPC
```

To run the fork tests against real UMA and Circle USDC, and to deploy, load the root `.env` first
(in WSL, from the repo root):

```bash
set -a; source <(sed 's/\r$//' .env); set +a; cd contracts
forge test                                                           # all 60
forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
forge script script/DeploySettlementReceiver.s.sol:DeploySettlementReceiver --rpc-url base_sepolia --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
```

After a redeploy, update the addresses in both env files and run `npm run gen:abi` if the ABI
changed.

`Demo.s.sol` drives a deployed escrow one step per call, which is how the live run was produced:

```bash
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "createGrant()"
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "claim(uint256,uint256,string)" 0 0 "https://…"
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "dispute(uint256,uint256)" 0 0
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "resolve(uint256,uint256,bool)" 0 0 false
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "settle(uint256,uint256)" 0 0
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --sig "status(uint256)" 0
```

It signs the claim attestation directly with the attestor key, so it exercises the contract, not the
Selfie Check. The web app issues that signature only after a real Selfie Check verifies.

### Web

```bash
npm run dev          # http://localhost:3001
```

Deploying? See **[DEPLOYMENT.md](DEPLOYMENT.md)**: Vercel with Root Directory `apps/web`, plus a Redis
store. Nothing else needs hosting.

### CRE settlement workflow

```bash
cre login
npm run workflow:typecheck
npm run workflow:simulate     # reads checkUpkeep; reports "no claims" or what it would settle
npm run workflow:broadcast    # the same, and actually writes the settlement on Base Sepolia
```

**Deploy access isn't granted to this org yet** (`cre account access`). Until it is, the workflow runs
from the CLI: real transactions, signed by our own key, through Chainlink's mock forwarder. That
proves the logic, not autonomy. Once access is granted:

```bash
cast send 0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95 'setForwarderAddress(address)' 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 --rpc-url base_sepolia --private-key "$DEPLOYER_PRIVATE_KEY"
cast send 0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95 'setExpectedAuthor(address)' <workflow owner> --rpc-url base_sepolia --private-key "$DEPLOYER_PRIVATE_KEY"
cd cre-workflow && cre workflow deploy ./settlement-workflow --target production-settings
```

Why CRE and not Chainlink Automation: Automation's testnet service was sunset on June 24, 2026, and
its Base Sepolia registry no longer performs upkeeps. The workflow follows Chainlink's documented
Automation-to-CRE migration: it runs the same `checkUpkeep`, then reaches the same `performUpkeep`.

---

## Configuration that is easy to get wrong

**World ID 4.x needs a Relying Party, not just an App ID.** IDKit requires an `rp_context` signed by
`@worldcoin/idkit-server`'s `signRequest()`. That means `WORLD_RP_ID` **and** `WORLD_RP_SIGNING_KEY`
as well as `NEXT_PUBLIC_WORLD_APP_ID`. The browser fetches a fresh context from `/api/idkit-context`
immediately before opening the widget.

**Selfie Check entitlement is server-side, per App ID.** Visit `/verify` to find out: a QR means the
App ID is enabled, and `credential_unavailable`/`feature_unavailable` means it is not.

**EIP-712 field order must match the contract exactly.** A mismatch doesn't error. Every signature
just recovers to the wrong address on-chain. `apps/web/lib/eip712.ts` mirrors the typehash strings
in `GrantEscrow.sol`, and its digests have been checked against the deployed contract.

**Answering a UMA dispute on testnet needs the exact request data.** The sandbox oracle only accepts
an answer for a price that was requested. The ancillary data is
`assertionId:<hex>,ooAsserter:<hex>`, and `ooAsserter` is the assertion's **asserter** (the grantee),
not the oracle. See `contracts/script/UmaSandbox.sol` and `apps/web/lib/uma.ts`.

**Values that `forge script` logs come from its local simulation.** Assertion ids and expiry times
include the block timestamp, so they differ from what was mined. Read them back with `status`.

**Granter access is an allowlist.** `NEXT_PUBLIC_GRANTER_ADDRESSES` decides which wallets see the
review queue. It is UI segregation, not authorisation: the money is protected on-chain regardless,
but `/api/applications` is reachable directly because the server can't authenticate a wallet without
a signature. Closing that means sign-in-with-Ethereum.

### Two env files, on purpose

| File | Read by | Contains |
| --- | --- | --- |
| `apps/web/.env.local` | Next.js | Only what the web app uses (the `[web]` values) |
| `.env` (repo root) | Foundry and the demo tooling | Deploy keys, RPC, demo wallets |

The escrow and USDC addresses and the attestor key appear in both and must be kept in step. Both
files are gitignored.

### The look is token-driven

The UI uses **Organic**, a warm cream/terracotta system imported from Claude Design. Every colour,
radius and shadow is a CSS custom property in `apps/web/app/globals.css`, and dark mode is one
attribute (`[data-theme="dark"]`) re-declaring the same tokens. Milestone status colours live in
`apps/web/lib/status.ts` so every view agrees.

---

## Departures from the docs

- **`IDKitWidget` does not exist in `@worldcoin/idkit@4.x`.** This app uses the `useIDKitRequest` hook
  with the `selfieCheckLegacy()` preset, so the grant flow and `/verify` share one code path.
- **Proof verification is `POST /api/v4/verify/{rp_id}` on `developer.world.org`**, with the complete
  IDKit result forwarded verbatim.
- **`ReceiverTemplate.sol` is not an npm package.** Chainlink publishes it as a copy-paste file, so
  `contracts/src/automation/ReceiverTemplate.sol` is an independent implementation of the documented
  behaviour.
- **The CRE SDK exports `TxStatus` but not `ReceiverContractExecutionStatus`.** The workflow pins
  `SUCCESS = 0` from the protobuf and checks both statuses, because the forwarder's transaction can
  succeed while the receiver reverts inside it.

## Known gaps

- **The CRE workflow isn't autonomous yet.** It needs deploy access; until then settlement is by
  anyone pressing Settle, or the workflow run from the CLI.
- **Testnet disputes are answered through UMA's sandbox oracle, which anyone can answer.** That's a
  demo stand-in for UMA's token-holder vote, and the UI labels it as such. On Base mainnet the same
  dispute goes to the real vote.
- **A person can change their payout wallet only once.** World ID nullifiers are stable per person per
  action, and the contract spends them on first use.
- **A claim attestation is tied to the grant's claim nonce.** If another claim on the same grant lands
  between signing and submitting, the grantee prepares it again.
- **One Redis key holds every application.** Fine at grant-round scale, wrong at ten thousand.
- **No audit.** The contracts are tested, including against live UMA, but nothing here has been
  reviewed for mainnet money.
