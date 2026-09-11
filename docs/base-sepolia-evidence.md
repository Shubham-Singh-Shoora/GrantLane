# GrantLane on Base Sepolia — live run

The UMA-based `GrantEscrow` running against the real UMA Optimistic Oracle V3 and Circle USDC on Base Sepolia (chain 84532). Every step below is a mined transaction.

| | |
|---|---|
| GrantEscrow | [`0x85AC2a3e1EBc0959599025eB6eF36eD34c862840`](https://sepolia.basescan.org/address/0x85AC2a3e1EBc0959599025eB6eF36eD34c862840) |
| Deploy tx | [`0x564f7d3d…3ad2`](https://sepolia.basescan.org/tx/0x564f7d3d791eca8b5d902f3c3a8354b55fc0660fa491ab114b90b0d7e5563ad2) |
| UMA Optimistic Oracle V3 | [`0x0F7fC5E6482f096380db6158f978167b57388deE`](https://sepolia.basescan.org/address/0x0F7fC5E6482f096380db6158f978167b57388deE) |
| USDC (Circle) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| Dispute window | 300 s (demo setting; 48 h in real use) |
| Bond | 1 USDC, for the claimant and any disputer alike |

## Grant 0 — 4 USDC, two milestones of 2 USDC

| Step | Who | Transaction |
|---|---|---|
| Fund the grant | Grantor | [`0x7917ff1e…3f78`](https://sepolia.basescan.org/tx/0x7917ff1e4e2badb53b3daad1d5eb0d770b12ab575bcc204a946b653201d93f78) |
| Claim milestone 0, 1 USDC bond | Applicant | [`0x7963079e…c16c`](https://sepolia.basescan.org/tx/0x7963079e356f8b3c632b31a228d6178b8146d0fb0329074f881b25c50497c16c) |
| Claim milestone 1, 1 USDC bond | Applicant | [`0xac4fe088…b30d`](https://sepolia.basescan.org/tx/0xac4fe08871b83b4d8cb76f531e7409c4a42dd4e88a56f53460effa0e7bc1b30d) |
| Dispute milestone 1, 1 USDC bond | Grantor | [`0x25c0d1a3…e4f4`](https://sepolia.basescan.org/tx/0x25c0d1a3e9009288dd14ef01bf9c1272bb0bf25ce79c71d5a497a5692a33e4f4) |
| UMA sandbox rules the claim false | UMA mock oracle | [`0xc1ae73df…492e`](https://sepolia.basescan.org/tx/0xc1ae73df44673f5eb99b32de7423e062bcb8bad17f544b4eb15f4f6c1a0b492e) |
| Settle milestone 1 → Rejected | Anyone | [`0x3964b62d…84f3`](https://sepolia.basescan.org/tx/0x3964b62d98b4c391f7c0f22b06ce3c3cc390ae772dfdbd1c4ee14489303584f3) |
| Settle milestone 0 after the window → Approved | Anyone | [`0x0a31766c…b956`](https://sepolia.basescan.org/tx/0x0a31766cf1d9980650a163838ae0def95dc40a6514bf458ffe3ad942e0dbb956) |
| Withdraw 2 USDC | Applicant | [`0xe6e4c221…fc48`](https://sepolia.basescan.org/tx/0xe6e4c221d85a4daa3f37d721cc4796540674b8fe2ac96256b2ff561cc66dfc48) |

Balances afterwards, each wallet having started with 20 USDC:

| Wallet | USDC | Why |
|---|---|---|
| Applicant | 21 | −2 bonds, +1 bond returned, +2 milestone payout |
| Grantor | 16.5 | −4 grant, −1 dispute bond, +1.5 won back (own bond + half the applicant's) |
| Escrow | 2 | milestone 1's funds, still held while it is Rejected |

Milestone 0 went undisputed: once its window closed it settled true, UMA returned the applicant's bond, and the 2 USDC was credited for withdrawal. Milestone 1 was claimed with deliberately weak evidence; the grantor disputed it, the applicant lost their bond, and the grantor received it back plus half the applicant's (the other half is UMA's burn). The milestone reopened as Rejected.

## What is and isn't real here

- **Real:** the escrow, UMA's Optimistic Oracle V3, its bond handling and callbacks, Circle USDC, and the settlement and payout.
- **Testnet stand-in:** the dispute was answered through UMA's sandbox oracle (`MockOracleAncillary`), which on testnets takes the place of UMA's token-holder vote. On Base mainnet the same dispute would go to that vote.
- **CLI shortcut:** these claims were sent with [`script/Demo.s.sol`](../contracts/script/Demo.s.sol), which signs the Selfie Check attestation directly with the attestor key. In the web app that signature is only issued after a real World ID Selfie Check is verified. This run exercises the contract, not the Selfie Check.

## Settlement by a CRE workflow

Chainlink Automation's testnet service was sunset on June 24, 2026, and its Base Sepolia registry has stopped performing upkeeps. So settlement runs as a Chainlink CRE cron workflow, [`cre-workflow/settlement-workflow`](../cre-workflow/settlement-workflow/main.ts), following Chainlink's Automation-to-CRE migration path. On each tick it reads `checkUpkeep` from the escrow. If claims have outlived their dispute window, it signs a report whose payload is the escrow's own `performData`, and the forwarder delivers it to a [`SettlementReceiver`](../contracts/src/automation/SettlementReceiver.sol) that can only call `GrantEscrow.performUpkeep`.

| | |
|---|---|
| SettlementReceiver | [`0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95`](https://sepolia.basescan.org/address/0x5c7f09FDf7bC860AF7F0C5EcBD220B3391583a95) |
| Forwarder it currently trusts | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` (MockKeystoneForwarder, used by simulation) |
| Forwarder after DON deployment | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (KeystoneForwarder) |

| Step | Who | Transaction |
|---|---|---|
| Deploy SettlementReceiver | Grantor | [`0xd03334a1…5ec0`](https://sepolia.basescan.org/tx/0xd03334a10caf6b140defeaf031fded2d8e93495f1cb6d2c6b8d69f123da15ec0) |
| Re-claim milestone 1, now that the deployment is published | Applicant | [`0x60b1d6ec…a3f8`](https://sepolia.basescan.org/tx/0x60b1d6ec0cfb5bb002f6f1a6d5db456142eb2d37af8af0769a77015b994ca3f8) |
| Workflow run before the window closed: "No claims are past their dispute window." | CRE workflow | none, read only |
| Workflow run after the window closed: settles milestone 1 → Approved | CRE workflow | [`0x1c0040c9…7333`](https://sepolia.basescan.org/tx/0x1c0040c9f0aeec982ac2a1363283a960f201f4c439782de6ae99a73548407333) |
| Withdraw 2 USDC | Applicant | [`0x4baf0866…9142`](https://sepolia.basescan.org/tx/0x4baf0866baffed0b726b3e464298be6e793c51abb3f8c8a904d46f5ca5ca9142) |

The settling transaction went from the CRE CLI signer to the MockKeystoneForwarder, which called `SettlementReceiver.onReport`. The receiver emitted `SettlementRelayed(1)` and called `GrantEscrow.performUpkeep`, which settled the claim on UMA. The applicant ended with 23 USDC: 21 before, less a 1 USDC bond, plus the bond returned and the 2 USDC milestone. The escrow now holds nothing: both milestones are paid.

**What this does and doesn't show yet.** It shows the workflow's read, report and write path, the receiver, and the escrow's settlement working end to end on-chain. CRE deploy access is still pending, so these runs were started from the CRE CLI. The transaction was signed by our own wallet and passed through Chainlink's mock forwarder, which does not check DON signatures. It is not autonomous yet. Once access is granted, the same workflow is deployed to a DON and the receiver is pointed at the production forwarder. From then on it settles every minute without anyone starting it.

Reproduce any step with, for example:

```bash
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "status(uint256)" 0
```
