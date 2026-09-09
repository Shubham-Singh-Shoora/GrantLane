# World developer feedback — GrantLane

Running notes from integrating World ID into GrantLane. Started 2026-09-09, first day of the build.

**What we used World ID for:** gating a change of payout wallet on a grant escrow. This is the one
action where "is there a live human here, and is it the same one as before?" actually matters — it
is the step an attacker takes after stealing a session, and the one a grantee takes legitimately
after losing a key. Everything else in the app is authorised by a normal wallet signature.

**Integration surface:** `@worldcoin/idkit@4.2.3` in a plain Next.js web app (not a Mini App),
`selfieCheckLegacy()` preset, proof verified server-side, result turned into an EIP-712 attestation
the user submits on-chain themselves.

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

### 5. Selfie Check being beta-gated is discoverable too late

The gate is mentioned in a one-line comment in the type definition
(`"Preview: Selfie Check is currently in preview. Contact us if you need it enabled."`) and in the
docs, but it is easy to build the whole flow before discovering that the credential will not return
proofs for your app id. For a time-boxed hackathon that is an expensive discovery.

**What would have helped:** surface the gate in the Developer Portal UI — show Selfie Check in the
credential list with a "request access" button and a clear disabled state, rather than having it
fail at proof time.

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
