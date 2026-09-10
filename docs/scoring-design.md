# Making milestone scoring real

## The problem

Today's scorer takes the word before each colon in the rubric and asks whether that string
appears anywhere in the submission. Four criteria, threshold 70%, so three matching words releases
the money.

Typing *"pull request, tests, demo, docs"* scores 100%.

This is worse than having no scoring. No scoring is honest about needing a human. This produces a
number, calls it a confidential score, and pays out on it — the assurance is fake and the payout is
real. **It has to be replaced before anyone funds anything they care about.**

What the current build genuinely demonstrates is *where* judgement runs — sealed, with only a verdict
leaving the enclave — and that only a DON-signed report can move money. Both of those survive
everything below. It is the judgement itself that is missing.

---

## The reframe: attest, then advise, then decide

The instinct to keep a human in the loop is right, and it resolves the tension. Trying to make the
enclave the sole judge is what forces it to fake certainty it cannot have. Split the job into three
things, each done by whatever is actually good at it:

| Layer | Does | Good at |
| --- | --- | --- |
| **Attest** | Checks facts against real sources | Machines. Unambiguous, unfakeable |
| **Advise** | Judges quality against the rubric | Models. Reading, consistency |
| **Decide** | Approves the payout | The granter. Accountability |

The enclave stops being an oracle of truth and becomes something more useful: a **tamper-proof
evidence gatherer** whose findings the granter can trust without reading the submission themselves.

Note what this does *not* give up. The granter still cannot fabricate a payout — releasing money
still requires a DON-signed report. Adding a human approval step makes payment require **two keys**,
not one. It is strictly stricter than today.

---

## Layer 1 — Verifiable checks (do this first)

The single biggest upgrade, and the one that kills the gimmick problem outright. Instead of matching
words, the enclave calls the real sources and checks claims.

Criteria stop being free text and become **typed checks** the granter picks when setting milestones:

```jsonc
{ "type": "github_pr_merged",  "repo": "owner/name", "label": "milestone-1", "minCount": 1 }
{ "type": "ci_passing",        "workflow": "test.yml", "onCommit": "head" }
{ "type": "coverage_at_least", "threshold": 80 }
{ "type": "release_tagged",    "pattern": "v1.*", "withAssets": true }
{ "type": "url_live",          "url": "https://…", "mustContain": "Fieldnote" }
{ "type": "contract_verified", "chain": "arc-testnet", "address": "0x…" }
{ "type": "human_review",      "question": "Do the audit findings actually close the issues raised?" }
```

Each type has one verifier. A claim either checks out or it does not — there is nothing to phrase
cleverly. Someone writing *"I merged a pull request"* gets **zero** unless a merged PR exists.

**Why this is the right first move:** it is deterministic, so DON consensus is trivial; it needs no
model; and it converts the vaguest part of granting — *"what counts as done?"* — into something both
sides agree on **before work starts**. Most milestone disputes are really specification disputes.

### Anti-gaming rules the verifier must enforce

Checks are only as good as what they refuse. Each of these closes a real hole:

- **Time-bounded.** Commits, PRs and releases must be dated after the milestone was funded —
  otherwise last year's work claims this year's grant.
- **Ancestry.** The commit must be an ancestor of the default branch. A PR merged into a throwaway
  branch is not delivery.
- **Repo pinned at application time.** The repo is fixed when the grant is funded, so nobody
  substitutes a more impressive project later.
- **Reachable from the enclave.** A URL check runs from inside the TEE — `localhost` and
  private ranges fail.
- **Evidence bound to one milestone.** The evidence hash is already on-chain; refuse a hash already
  spent on another milestone.
- **Authorship.** The PR author should be the applicant or a declared collaborator.

---

## Layer 2 — Model judgement, for the parts that need reading

Some criteria genuinely require comprehension: *does this document explain the change?* *does the
audit close its findings?* That is a model's job, called from inside the enclave over confidential
HTTP so the submission still never leaves.

**The real risk is consensus.** Multiple DON nodes score independently and must agree. A model that
returns slightly different prose per call breaks that, and the run fails. Mitigations, in order of
importance:

1. **Structured output only.** A JSON schema of `{criterionId, pass, confidence, rationale}` —
   consensus is reached on the booleans, never the prose.
2. **Temperature 0**, fixed seed, pinned model version.
3. **Aggregate the decision, not the text.** Take the median/majority per criterion.
4. **Fail closed.** Nodes disagreeing means the answer is not robust — that should route to human
   review, not to a coin flip.

Treat the model's output as **advisory and always visible to the granter**, never as the sole reason
money moved.

---

## Layer 3 — The granter's final call

Contract change. `_processReport` stops paying and starts *recording*:

```solidity
// Report lands: milestone becomes Scored, with the verdict attached.
enum MilestoneStatus { Pending, Submitted, Scored, Approved, Rejected, Paid }

function _processReport(bytes calldata report) internal override {
    (uint256 grantId, uint256 milestoneId, uint16 scoreBps,
     uint32 checksPassed, uint32 checksTotal, bool requiredAllPassed,
     bytes32 findingsHash) = abi.decode(report, (...));

    milestone.status   = MilestoneStatus.Scored;
    milestone.scoreBps = scoreBps;
    milestone.findings = findingsHash;   // commitment to the full report
    emit MilestoneScored(grantId, milestoneId, scoreBps, findingsHash);
}

/// Only the funder, and only on a milestone the DON has already scored.
function approvePayout(uint256 grantId, uint256 milestoneId) external nonReentrant {
    require(msg.sender == grant.funder,                     "not funder");
    require(milestone.status == MilestoneStatus.Scored,     "not scored");
    require(milestone.requiredAllPassed,                    "required checks failed");
    // …release
}
```

Two keys: the DON must have scored it, **and** the granter must approve. Neither alone pays.

### Keep the speed where it is deserved

A blanket human gate reintroduces the bottleneck the product exists to remove. Make the policy
explicit and on-chain per grant:

| Outcome | Policy |
| --- | --- |
| All required checks pass **and** score ≥ auto threshold (say 90%) | Pays automatically |
| Score ≥ pass mark but below auto threshold | Waits for the granter |
| Any required check fails | Auto-rejected with the failing checks named |

The granter sets both thresholds when funding. A milestone that is *purely* mechanical —
"the release is tagged and CI is green" — can still settle with nobody in the loop. Judgement calls
get a human. That is the distinction worth encoding.

### Timeouts, so silence isn't a veto

If the granter neither approves nor rejects within an agreed window, the grantee should have a
path — auto-approve on a clean score, or an escalation. Otherwise "final human call" becomes
"funder can strand your money by ignoring you", which is the failure mode escrow was supposed to fix.

---

## Findings must be legible

A score with no reasons is another black box. The report carries `findingsHash`; the full findings
live off-chain and are shown to both sides:

```
Milestone 2 — Independent audit                       Scored 72% · needs review
  ✓ required  audit report published        pdf reachable, 41 pages
  ✓ required  high findings closed          3 of 3 marked resolved
  ✗           coverage ≥ 80%                measured 74%
  ⚠ advisory  report addresses the milestone model: partially — §4 not covered
```

The granter approves or rejects **against that**. The grantee can see exactly what to fix. Neither
side has to read a number and trust it.

---

## Suggested order

1. **Rip out keyword matching.** Until it is gone, every number the product shows is misleading.
   If Layer 1 is not ready, show "awaiting review" and route everything to the granter — honest and
   strictly better.
2. **Layer 1 checks**, starting with `github_pr_merged`, `ci_passing`, `url_live`. Those three cover
   most software milestones and need no model.
3. **Typed criteria in the granter's milestone builder**, so criteria are machine-checkable by
   construction rather than prose someone later has to interpret.
4. **Layer 3 contract change** — `Scored` status plus `approvePayout`, with the auto-approve
   threshold so clear-cut cases still settle instantly.
5. **Layer 2 model judgement**, last. It is the most interesting and the least load-bearing: by then
   the mechanical facts are already verified and a human already has the final word.

Steps 1–3 need no contract change and remove the dishonesty. Step 4 is where the two-key model lands.
