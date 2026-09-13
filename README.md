# GrantLane

**Milestone grant escrow where a claim has to survive a challenge before it pays.**

A grantor locks USDC against a list of milestones up front. When a milestone is done, the builder publishes their evidence and claims it on UMA's Optimistic Oracle with a small USDC bond. The claim is open to dispute for a fixed window: if nobody disputes it, it pays out; if someone does, UMA decides, and whoever was wrong loses their bond.

World ID Selfie Check makes sure a real person is behind every application and every claim, and a Chainlink CRE workflow settles claims once their window closes. Nobody approves milestones by hand, and no key can release the escrowed money. GrantLane runs on Base Sepolia.

## Demo video

<!-- Replace this line with the demo video link. -->
Coming soon.

## Documentation

- [Architecture](docs/GrantLane-Architecture.pdf) — how the pieces fit and interact, with diagrams
- [Project structure](docs/GrantLane-Project-Structure.pdf) — every module and what it does
- [CRE settlement workflow](docs/GrantLane-CRE-Settlement-Workflow.pdf) — how claims are settled automatically
