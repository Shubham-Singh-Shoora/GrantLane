# Demo script

A walkthrough of GrantLane in about four minutes, for a recording or a live demo. It uses two
wallets on Base Sepolia, each holding a little ETH for gas and a few USDC:

- **Grantor**: an address in `NEXT_PUBLIC_GRANTER_ADDRESSES`.
- **Applicant**: any other address, with World App for the Selfie Checks.

The dispute window is 5 minutes, so start the claim early and talk over the countdown.

---

## 1. The problem (20 s)

Open the landing page.

> "Grant money either waits on a reviewer for every milestone, or goes out on trust. GrantLane does
> neither. A builder claims a milestone with a bond, anyone can challenge the claim, and UMA settles
> the challenge. Lying costs money, and nobody approves anything by hand."

## 2. Apply (40 s), as the applicant

`/apply`. Fill in the project, the repo (the card fills in from GitHub), and two milestones with
concrete criteria. Run the **Selfie Check**, then submit.

> "The Selfie Check means the queue is people, not scripts. Each gate uses its own World ID action,
> so a proof farmed at one is useless at the next."

## 3. Fund (40 s), as the grantor

Switch wallets. `/applications` → open the application → adjust the milestones → **Escrow**.
Approve USDC, then `createGrant`.

> "The whole grant is locked up front. Along with the amounts, the escrow stores a hash of the
> milestone terms, so they can't be quietly edited after a claim is made."

## 4. Claim (50 s), as the applicant

Open the grant → milestone 1 → **Selfie Check** → fill in the evidence: what was delivered, plus a
live link, demo video or repo → **Claim with a 1 USDC bond**. Approve the bond, then `submitMilestone`.

> "The evidence is published at a link that goes into the claim on UMA, with its hash. The claim
> is now open to dispute for five minutes."

Open **Read the evidence**. Point at the three checks: the bundle matches its hash, it's the claim
on-chain now, and the terms match the on-chain commitment.

## 5a. The undisputed path (while the timer runs)

Let the countdown reach zero, then press **Settle and release**, from either wallet. The milestone
reads **Approved**. In the **Withdraw** panel the payout wallet collects the USDC. The applicant's
bond is already back.

> "Anyone can settle once the window closes. The applicant has every reason to, and a Chainlink CRE
> workflow is built to do it on a schedule."

## 5b. The dispute path (milestone 2)

Claim milestone 2 with weak evidence. As the grantor, press **Dispute** (1 USDC bond). In the dashed
**Testnet only** panel, answer **Claim was false**, then **Settle**. The milestone reads **Rejected**
and reopens. The grantor received their bond back plus half the applicant's; the other half is
UMA's burn.

> "On mainnet this dispute goes to UMA's token-holder vote. On testnet we answer it through UMA's
> sandbox oracle, and the app says so."

## 6. Chainlink CRE (30 s)

In a terminal:

```bash
npm run workflow:simulate     # after a window closes: "Settling 1 claim(s): 0x…"
npm run workflow:broadcast    # writes it: forwarder → SettlementReceiver → performUpkeep
```

> "Chainlink Automation was sunset on testnets in June, so settlement moved to CRE along Chainlink's
> migration path. The workflow reads the escrow's checkUpkeep and sends a signed report to
> performUpkeep. Today we start it from the CLI because deploy access is pending; once it's granted
> the same workflow runs every minute on its own."

## 7. Close (15 s)

Open `/admin` as the grantor: escrowed, released, open claims, disputes.

> "No one approved a milestone, no admin key can release or hold the money, and every step here is a
> transaction you can check on Basescan."

---

**Don't claim more than is true on camera.** The CRE workflow is not autonomous until it's deployed;
testnet disputes are answered by the sandbox oracle, not a real vote; and a claim made from
`localhost` links to localhost evidence, so record against the deployed app with `NEXT_PUBLIC_APP_URL`
set.
