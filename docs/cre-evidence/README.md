# Chainlink CRE evidence — GrantLane

> **Historical.** This documents GrantLane's first design: a CRE workflow that scored milestone
> evidence inside a TEE and paid on Arc Testnet (chain 5042002). It was retired because keyword
> scoring couldn't judge whether work was good. Milestones are now bonded claims settled through UMA
> on Base Sepolia, and CRE's role is the settlement workflow (see the main README and
> [../base-sepolia-evidence.md](../base-sepolia-evidence.md)). The runs recorded here are still real
> transactions on Arc, and the workflow source they refer to is in git history.

This directory holds the artefacts required for the Chainlink track: simulation output, execution
logs, and the reasoning behind how the workflow is structured.

## What the workflow does

`cre-workflow/grant-evaluation-workflow/main.ts` registers a single handler on an HTTP trigger,
declared with `cre.handlerInTee(...)` and bound to a Nitro enclave in `us-west-2`.

Inside the enclave:

1. `runtime.getSecret({ id: "GRANT_REVIEW_RUBRIC" })` fetches the reviewer rubric. It never leaves
   the TEE.
2. `ConfidentialHTTPClient.sendRequest(...)` fetches the full evidence bundle from the app server.
3. The evidence is scored against the rubric, producing `{ approved, scoreBps }`.

Crossing back out:

4. `runtime.usingTheDons()` returns a DON-mode `Runtime`. Only the verdict crosses this boundary —
   not the rubric, not the evidence text, not the per-criterion reasoning.
5. `donRuntime.report({ encodedPayload, encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })`
   produces the DON-signed report.
6. `evmClient.writeReport(donRuntime, { receiver, report, gasConfig })` delivers it to `GrantEscrow`
   on Arc Testnet.

## Why a TEE rather than plain DON execution

The confidential part is not the *outcome* — approvals and scores are public on-chain. It is the
**rubric** and the **submission**. A grant program that publishes its rubric gets gamed; a grantee
who has to publish their submission to get paid will not submit anything commercially sensitive.
Running the scoring in an enclave is what lets both stay private while the payout stays verifiable.

Hence the split: `handlerInTee` for the judgement, `usingTheDons()` for the settlement.

## Why the report is the only thing that can pay

`GrantEscrow` extends `ReceiverTemplate`, whose `onReport` rejects any caller that is not the
configured `KeystoneForwarder`, and (when set) any report whose workflow owner does not match
`s_expectedAuthor`. There is no owner function, no server key, and no multisig that can release
escrowed funds — only a report that survived DON consensus.

`test_onReport_revertsFromNonForwarder` and `test_onReport_enforcesExpectedAuthorWhenSet` in
`contracts/test/GrantEscrow.t.sol` cover both gates.

## Verified environment

| | |
| --- | --- |
| CRE CLI | `v1.32.0` (Arc support requires ≥ 1.0.7) |
| CRE TS SDK | `@chainlink/cre-sdk@1.20.0` (Arc support requires ≥ 1.3.1) |
| Bun | `1.4.2` (SDK requires ≥ 1.2.21) |
| Arc Testnet chain id | `5042002`, confirmed live via `eth_chainId` → `0x4cef52` |
| Arc chain selector | `arc-testnet` → `3034092155422581607`, from the SDK's `SUPPORTED_CHAIN_SELECTORS` |
| KeystoneForwarder (Arc Testnet) | `0x76c9cf548b4179F8901cda1f8623568b58215E62` |

The workflow typechecks against the real SDK:

```bash
npm run workflow:typecheck    # clean
```

## Captured

A full live run — TEE scoring through to USDC leaving escrow on Arc — is written up in
[live-payout-run.md](./live-payout-run.md), including the report tx, before/after balances and the
resulting milestone state.

| | |
| --- | --- |
| Workflow builds to WASM | `cre workflow build` — binary hash `a68d1e96…52d4c5` |
| Simulation passes | scored 10000 bps, approved, TEE bound to AWS Nitro us-west-2 |
| Live payout on Arc | tx `0xbf1412ac…4bc7b3`, block 61242269, 0.6 USDC released |
| Deploy access | **not yet enabled** on this org — run `cre account access` |
