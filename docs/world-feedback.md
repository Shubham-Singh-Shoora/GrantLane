# World developer feedback — GrantLane

Running notes from integrating World ID into GrantLane. Started 2026-09-09, first day of the build.

**What we used World ID for:** gating a change of payout wallet on a grant escrow. This is the one
action where "is there a live human here, and is it the same one as before?" actually matters — it
is the step an attacker takes after stealing a session, and the one a grantee takes legitimately
after losing a key. Everything else in the app is authorised by a normal wallet signature.

**Integration surface:** `@worldcoin/idkit@4.2.3` in a plain Next.js web app (not a Mini App),
`selfieCheckLegacy()` preset, proof verified server-side, result turned into an EIP-712 attestation
the user submits on-chain themselves.

**Status:** working. The App ID is entitled to request Selfie Check — a live request returns a
`world.org/verify` connector link, rendered as a QR at `/verify`. See note 5 below, which is the
single most useful piece of feedback in this document.

---

## What worked well

**The preset API is the right abstraction.** `selfieCheckLegacy({ signal })` reads exactly like
what it does, and swapping credentials is a one-line change. Being able to bind a `signal` to the
specific action (`grantId:newWallet`) without thinking about ABI encoding is a real ergonomic win.

**Nullifiers make replay protection obvious.** Getting a stable nullifier back from verification
meant the on-chain replay guard was three lines and needed no extra bookkeeping. The design
practically tells you what to do.

**Types are genuinely good.** `IDKitResult` being a discriminated union across v3/v4/session, with
`protocol_version` as the tag, made handling the legacy path safe. The doc comments in
`idkit-core`'s `.d.ts` were more useful than the docs site in several places.

---

## Friction, roughly in order of how much time it cost

### 1. `rp_context` is required, and nothing in the getting-started path prepares you for it

This was the single biggest surprise. `IDKitRequestConfig` requires `rp_context`, which needs a
registered Relying Party **and** an ECDSA signing key, with the signature produced by
`signRequest()` from a *different* package (`@worldcoin/idkit-server`).

The practical consequence: **there is no client-only integration**. Even a demo needs a server route
to mint a signed context before the widget can open. That is a defensible security decision, but
the framing in the quickstart still reads like "drop in a component and pass your app id", which is
no longer true.

**What would have helped:** say up front, on the first page, that World ID 4.x requires RP
registration and a server-side signing step, and show the `/api/idkit-context` shape as part of the
canonical example rather than leaving developers to discover it from `.d.ts` files.

### 2. `IDKitWidget` is gone, and searching for it finds stale answers

Every tutorial and blog post — and our own build spec — refers to `IDKitWidget`. In 4.x the exports
are `IDKitRequestWidget`, `IDKitSessionWidget`, `IDKitInviteCodeRequestWidget`, plus matching hooks.
We only found this by extracting the package and reading `index.d.ts`.

**What would have helped:** a short "migrating from IDKitWidget" note, or even a deprecated shim
that throws with a pointer to the new name. The rename is good; the discoverability is not.

### 3. Two packages named almost identically, with a non-obvious split

`@worldcoin/idkit`, `@worldcoin/idkit-core`, `@worldcoin/idkit-server`. We needed all three: the
React widget, the types, and `signRequest`. Which symbol lives where is not documented anywhere we
could find — we worked it out by grepping `.d.ts` files.

Notably `idkit-server` does **not** export a verification helper, which is what we first went
looking for. Verification is an HTTP call you construct yourself. That is a reasonable choice, but
the package name strongly implies otherwise.

**What would have helped:** one table in the docs: symbol → package. And either a `verifyProof`
helper in `idkit-server`, or a line in its README saying explicitly that verification is not its job.

### 4. The verify endpoint moved, and the old shape is what search engines return

We initially built against `POST /api/v2/verify/{app_id}` with a `verification_level` field, because
that is what every search result describes. The current API is
`POST /api/v4/verify/{rp_id}` on `developer.world.org`, and it wants the **complete IDKit result
forwarded verbatim** — no remapping, no synthesised `verification_level`.

The current docs are clear once you land on the right page. The problem is entirely that the old
page still dominates search.

**What would have helped:** a prominent deprecation banner on the v2 reference pointing at v4.

### 5. The "preview" docstring outlived the gate, and cost us a day of hedging

`SelfieCheckLegacyPreset` still carries the line *"Preview: Selfie Check is currently in preview.
Contact us if you need it enabled."* in its type definition. We read that, emailed for access, and
planned around being blocked.

We were not blocked. Calling `selfieCheckLegacy()` against our App ID returned a working connector
link immediately — no `credential_unavailable`, no `feature_unavailable`. The entitlement gate is
server-side and was already open for us; the docstring is stale text in a package published well
before we tried it.

The cost was not technical, it was planning: we sequenced the whole build around an assumed blocker
and only discovered otherwise by ignoring the comment and calling the function.

**What would have helped:** two things, both cheap.

1. **Don't ship gate information as a docstring.** A comment in a `.d.ts` cannot know your app's
   entitlement, so it will be wrong for somebody no matter what it says. It reads as authoritative
   because it ships with the code.
2. **Expose entitlement in the Developer Portal**, per credential, per App ID — a simple
   enabled/disabled badge. The only way we could answer "is this app allowed to request Selfie
   Check?" was to attempt a real request and read the error code. That is a fine fallback; it is a
   poor primary mechanism.

The error codes themselves are good — `credential_unavailable` and `feature_unavailable` are exactly
the right granularity, and made it easy to build a diagnostic page that reports the gate state
honestly. The problem is only that attempting the call is the *only* way to reach them.

---

## Smaller notes

- `IDKitErrorCode` is a good, specific union — `nullifier_replayed`, `timestamp_too_old`,
  `unknown_rp` are all immediately actionable. More SDKs should do this.
- The `signal` is hashed into `signal_hash` on the response, but the response identifier for the
  Selfie Check credential is `"selfie"` while the preset is called `SelfieCheckLegacy`. Minor, but
  we had to verify the mapping by reading types rather than docs.
- `handleVerify` running *before* `onSuccess` is a genuinely useful ordering — it let us fail the
  whole interaction if our own attestation step refused, instead of showing the user a success
  screen and then an error. Worth documenting more prominently.

---

## Would we use World ID again for this?

Yes, and specifically for this shape of problem. The value was not "prove the user is human" in the
abstract — it was having a *portable, replay-resistant* signal we could turn into an on-chain
authorisation without running our own identity stack. The nullifier is what made that clean.

The cost was almost entirely in discovery, not in the API itself. Every hour we lost was to finding
out what the current surface is; almost none was to using it once found.
