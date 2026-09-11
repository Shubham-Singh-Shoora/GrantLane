# GrantLane contracts

Foundry project. Solidity 0.8.24, OpenZeppelin 5.1.

| File | What it is |
| --- | --- |
| `src/GrantEscrow.sol` | Milestone escrow. Claims are UMA Optimistic Oracle V3 assertions with a USDC bond; UMA's callbacks credit or reopen the milestone; settlement is permissionless; payouts are withdrawn. Selfie Check attestations (EIP-712) gate claims and payout-wallet changes. |
| `src/automation/SettlementReceiver.sol` | Receives a CRE report and passes it to `GrantEscrow.performUpkeep`. Can call nothing else. |
| `src/automation/ReceiverTemplate.sol` | Forwarder and workflow-owner checks for CRE reports. |
| `src/interfaces/` | Minimal UMA and Automation-compatible interfaces. |
| `test/GrantEscrow.t.sol` | 45 tests against a mock oracle that follows UMA's bond and callback rules. |
| `test/SettlementReceiver.t.sol` | 8 receiver tests. |
| `test/GrantEscrow.fork.t.sol` | 7 tests against the real UMA oracle and Circle USDC on a Base Sepolia fork. |
| `script/Deploy.s.sol` | Deploys the escrow (Base Sepolia defaults). |
| `script/DeploySettlementReceiver.s.sol` | Deploys the receiver against the simulation forwarder. |
| `script/Demo.s.sol` | Drives a live escrow one step per call: fund, claim, dispute, resolve, settle, withdraw, status. |
| `script/UmaSandbox.sol` | Rebuilds the dispute request data UMA's testnet oracle needs to be answered. |

```bash
forge test                       # fork tests skip unless BASE_SEPOLIA_RPC_URL is set
```

See the repository README for deployment and the demo commands.
