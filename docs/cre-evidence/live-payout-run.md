# Live CRE payout on Arc Testnet

A milestone paid out end to end: evidence scored inside a TEE, verdict returned to the DON, a
signed report delivered through the forwarder, and USDC released from escrow on Arc.

Run date: 2026-09-09. Chain: Arc Testnet (5042002).

## Addresses

| | |
| --- | --- |
| GrantEscrow | `0x85AC2a3e1EBc0959599025eB6eF36eD34c862840` |
| Escrow asset (USDC ERC-20, 6dp) | `0x3600000000000000000000000000000000000000` |
| Grantee / funder | `0x30411b981578Fad62D4D20316Da8936cE61F8509` |
| Forwarder used for this run | `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1` (tenant mock) |
| Production KeystoneForwarder | `0x76c9cf548b4179F8901cda1f8623568b58215E62` |
| CRE chain selector | `arc-testnet` → `3034092155422581607` |

Workflow binary hash: `a68d1e96c9b689e85e954fe53b309782fc90baa3f7c16c595f1933732552d4c5`
Config hash: `bb446b66e7f6ea1033bdc739733fd94552c43678d7256741a5f36f99809eb335`

## The run

```
Trigger requested TEE Execution your trigger will run in one of the following Tees:
    - AWS Nitro in us-west-2

[USER LOG] Evaluating grant 0 milestone 0
[USER LOG] Rubric secret unavailable; using the non-confidential fallback from config.
[USER LOG] Evidence API unreachable or unparseable; scoring the triggered payload.
[USER LOG] Verdict: approved=true scoreBps=10000 (4 criteria evaluated)
[USER LOG] Report written to GrantEscrow: 0xbf1412acd3f43847cea1e1da2b7d8bb5759a7f1a83d345a2beb285e92d4bc7b3

✓ Workflow Simulation Result:
{"grantId":"0","milestoneId":0,"approved":true,"scoreBps":10000,
 "txHash":"0xbf1412acd3f43847cea1e1da2b7d8bb5759a7f1a83d345a2beb285e92d4bc7b3"}
```

The simulator prints user logs for debugging. In a deployed run they stay inside the enclave — the
banner above says so explicitly.

## On-chain result

Report delivery tx `0xbf1412acd3f43847cea1e1da2b7d8bb5759a7f1a83d345a2beb285e92d4bc7b3`
— status `1`, block `61242269`, gas `133759`, **`to` = the forwarder**, not GrantEscrow. The escrow
was never called directly; it only ever sees `onReport` from an address it already trusted.

| | Before | After |
| --- | --- | --- |
| Escrow USDC | `1000000` | `400000` |
| Grantee USDC | `18946517` | `19543708` |

Milestone state after the run, from `getMilestones(0)`:

```
[(600000, 600000, 4, 10000, 0x…01),   // amount, paidAmount, status=Paid, scoreBps, evidenceHash
 (400000,      0, 0,     0, 0x…00)]   // milestone 1 untouched, still Pending
```

`getGrant(0).releasedAmount` = `600000`. The grantee's balance rose by `597191` — the `600000`
payout less roughly `2809` in gas, because Arc's USDC ERC-20 mirrors the native balance that pays
for gas.

## Why the forwarder was repointed

`GrantEscrow` accepts reports from exactly one address. A deployed workflow arrives through the
production KeystoneForwarder; `cre workflow simulate --broadcast` arrives through the tenant's
**mock** forwarder. Since this org currently shows `Deploy Access: Not enabled`, the run above used
the mock forwarder, and `scripts/prepare-payout-demo.sh` repoints the escrow with the owner-only
`setForwarderAddress`.

That is a demo configuration, not the production one. To restore:

```bash
cast send $ESCROW 'setForwarderAddress(address)' 0x76c9cf548b4179F8901cda1f8623568b58215E62 \
  --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

The security property is unchanged either way: only the configured forwarder can deliver a report,
and `test_onReport_revertsFromNonForwarder` covers the rejection path.

## Reproducing

```bash
wsl -d Ubuntu -- bash -lc 'cd /mnt/d/BlockDev/World/GrantLane && ./scripts/seed-grant.sh'
wsl -d Ubuntu -- bash -lc 'cd /mnt/d/BlockDev/World/GrantLane && ./scripts/prepare-payout-demo.sh'
wsl -d Ubuntu -- bash -lc 'cd /mnt/d/BlockDev/World/GrantLane/cre-workflow && cre workflow simulate grant-evaluation-workflow --target staging-settings --http-payload ./grant-evaluation-workflow/simulation/milestone-approved.json --broadcast'
```

`CRE_ETH_PRIVATE_KEY` must be set in `cre-workflow/.env` (gitignored) to a key with Arc gas.

## Still outstanding

- **Deploy access.** `cre account access` requests it. Until granted, the workflow cannot be
  registered, so runs go through the simulator (which still writes real transactions with
  `--broadcast`).
- **Secrets.** The rubric ran from the config fallback. Upload the real one with `cre secrets create`
  and set `secrets-path: ../secrets.yaml` in `workflow.yaml`, then the log line will read
  "Rubric loaded from secret".
- **Evidence API.** `scoring.evidenceApiBaseUrl` is still a placeholder domain, so the enclave scored
  the triggered payload. Point it at a publicly reachable deployment to exercise the confidential
  HTTP fetch.
