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

Reproduce any step with, for example:

```bash
forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast --sig "status(uint256)" 0
```
