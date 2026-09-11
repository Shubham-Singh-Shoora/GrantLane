"use client";

import Link from "next/link";
import { Reveal } from "./Reveal";
import { useRole } from "./RoleProvider";

/** The mark, blown up and animated — the road running out toward the spark. */
function RoadMotif() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" fill="none" aria-hidden>
      <path
        d="M60 16 L99 38.5 Q101 39.7 101 42 L101 73 Q101 79 96.5 83 L86 90 Q84 91.2 84 88.5 L84 52 A24 24 0 0 0 36 52 L36 88.5 Q36 91.2 34 90 L23.5 83 Q19 79 19 73 L19 42 Q19 39.7 21 38.5 Z"
        fill="var(--color-text)"
        opacity="0.9"
      />
      <path
        className="road-spark"
        d="M60 37 Q62.6 47.8 71.5 50.5 Q62.6 53.2 60 64 Q57.4 53.2 48.5 50.5 Q57.4 47.8 60 37 Z"
        fill="var(--color-accent)"
      />
      <path className="road-rung" style={{ animationDelay: "0s" }} d="M54 64.5 L66 64.5 L69.5 71.5 L50.5 71.5 Z" fill="var(--color-accent)" />
      <path className="road-rung" style={{ animationDelay: "0.25s" }} d="M49 74 L71 74 L76.5 82.5 L43.5 82.5 Z" fill="var(--color-accent)" />
      <path className="road-rung" style={{ animationDelay: "0.5s" }} d="M42 85 L78 85 L88 99.5 L32 99.5 Z" fill="var(--color-accent)" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Someone applies",
    body: "A pitch, a live site, a public repo, and how they'd split the work into milestones. A Selfie Check runs before submit, so the queue is builders and not scripts.",
  },
  {
    n: "02",
    title: "The granter escrows",
    body: "They read the proposal, adjust the scope they're willing to fund, and lock the whole grant on Base up front — along with a hash of the milestone terms, so the terms can't be edited later.",
  },
  {
    n: "03",
    title: "The builder claims",
    body: "When a milestone is done they verify they're human again, publish their evidence, and claim the milestone on UMA with a small USDC bond.",
  },
  {
    n: "04",
    title: "It pays unless challenged",
    body: "The claim is open to dispute for a set window. If nobody disputes it, it pays out. If someone does, UMA decides — and whoever was wrong loses their bond.",
  },
];

const GUARANTEES = [
  {
    kicker: "Bonded",
    title: "Lying costs money",
    body: "Every claim puts up a USDC bond. A claim that turns out to be false loses its bond to whoever proved it wrong — so claiming work you didn't do is a bet you expect to lose.",
  },
  {
    kicker: "Disputable",
    title: "Anyone can check, anyone can challenge",
    body: "The evidence is public, linked from the claim and hashed on-chain. The granter — or anyone — can dispute inside the window, and UMA's optimistic oracle settles it. No admin key can release the money, or hold it back.",
  },
  {
    kicker: "Human",
    title: "A person, not a farm",
    body: "World ID Selfie Check gates the three moments that matter — applying, claiming a milestone, and changing where the money lands. Each uses a different action, so a proof farmed at one gate is worthless at the others.",
  },
];

export function Landing() {
  const { isGranter } = useRole();

  return (
    <div className="pb-10">
      {/* ── hero ────────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-10 pb-16 pt-14">
        <div className="min-w-0 flex-1 basis-[380px]">
          <Reveal>
            <p className="card-kicker m-0">Milestone grants, settled on Base</p>
            <h1 className="mb-5 mt-2 text-[clamp(38px,6vw,58px)] leading-[1.02]">
              Fund the work.
              <br />
              Not the paperwork.
            </h1>
            <p className="m-0 max-w-[52ch] text-[16px] leading-relaxed" style={{ opacity: 0.78 }}>
              GrantLane escrows a grant up front and releases it milestone by milestone. A builder claims a milestone
              with evidence and a bond; if nobody disputes the claim in time, it pays out. Lying is expensive, and
              nobody has to approve every milestone by hand.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link href="/apply" className="btn-primary" style={{ fontSize: 15, padding: "12px 24px" }}>
                Apply for a grant
              </Link>
              <Link
                href={isGranter ? "/applications" : "/grants"}
                className="btn-secondary font-body font-semibold"
                style={{ fontSize: 15, padding: "12px 24px" }}
              >
                {isGranter ? "Review applications" : "See live grants"}
              </Link>
            </div>
          </Reveal>
        </div>

        <Reveal delay={200} className="min-w-0 flex-1 basis-[260px]">
          <div className="drift mx-auto max-w-[300px]">
            <RoadMotif />
          </div>
        </Reveal>
      </section>

      {/* ── the problem ─────────────────────────────────────────────────── */}
      <Reveal as="section" className="section-rule mt-16 pt-14">
        <div>
          <p className="card-kicker m-0">The problem</p>
          <h2 className="mb-6 mt-2 max-w-[18ch] text-[clamp(26px,4vw,36px)]">
            Grant money moves at the speed of somebody&apos;s inbox.
          </h2>
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {[
              [
                "Review is a bottleneck",
                "Every milestone waits on a human to read it, agree it counts, and remember to trigger a transfer.",
              ],
              [
                "Or it's paid on trust",
                "The alternative to slow review is paying on someone's say-so — and then nothing stops a claim that the work is done when it isn't.",
              ],
              [
                "Rounds attract scripts",
                "Open applications get farmed. Filtering them is manual, and the filtering falls on the same overloaded reviewer.",
              ],
            ].map(([title, body]) => (
              <div key={title}>
                <p className="m-0 font-heading text-[18px]">{title}</p>
                <p className="m-0 mt-2 text-[14px] leading-relaxed" style={{ opacity: 0.72 }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ── how it works ────────────────────────────────────────────────── */}
      <section className="section-rule mt-16 pt-14">
        <Reveal>
          <p className="card-kicker m-0">How it works</p>
          <h2 className="mb-8 mt-2 max-w-[20ch] text-[clamp(26px,4vw,36px)]">
            Four steps. Nobody approves a milestone by hand.
          </h2>
        </Reveal>

        {/* A rail with each step hanging off it — the road, laid flat. */}
        <ol className="relative m-0 list-none p-0 pl-9">
          <span
            className="absolute bottom-2 left-[13px] top-2 w-0.5"
            style={{ background: "var(--color-divider)" }}
            aria-hidden
          />
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i * 90} className="relative pb-9 last:pb-0">
              <span
                className="absolute left-[-36px] top-0 grid h-7 w-7 place-items-center rounded-full font-heading text-[11px]"
                style={{
                  background: i === 3 ? "var(--color-accent-2)" : "var(--color-accent)",
                  color: "var(--color-bg)",
                  boxShadow: "0 0 0 4px var(--color-bg)",
                }}
              >
                {step.n}
              </span>
              <p className="m-0 font-heading text-[20px] leading-tight">{step.title}</p>
              <p className="m-0 mt-2 max-w-[62ch] text-[14.5px] leading-relaxed" style={{ opacity: 0.75 }}>
                {step.body}
              </p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ── guarantees ──────────────────────────────────────────────────── */}
      <section className="section-rule mt-16 pt-14">
        <Reveal>
          <p className="card-kicker m-0">What makes it different</p>
          <h2 className="mb-8 mt-2 max-w-[22ch] text-[clamp(26px,4vw,36px)]">
            Three things the escrow enforces, not promises.
          </h2>
        </Reveal>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {GUARANTEES.map((item, i) => (
            <Reveal key={item.title} delay={i * 90}>
              <article className="card elev-sm h-full" style={{ padding: 24, gap: 10 }}>
                <p className="card-kicker m-0">{item.kicker}</p>
                <p className="m-0 font-heading text-[19px] leading-tight">{item.title}</p>
                <p className="m-0 text-[14px] leading-relaxed" style={{ opacity: 0.75 }}>
                  {item.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── stack ───────────────────────────────────────────────────────── */}
      <Reveal as="section" className="section-rule mt-16 pt-14">
        <div>
          <p className="card-kicker m-0">Built on</p>
          <h2 className="mb-7 mt-2 max-w-[24ch] text-[clamp(26px,4vw,36px)]">
            Each piece does the one thing it&apos;s best at.
          </h2>
          <dl className="m-0 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              [
                "Base + UMA",
                "Settlement. The escrow lives on Base; each claim is an optimistic assertion on UMA — bonded, public, and open to dispute.",
              ],
              [
                "Chainlink CRE",
                "Upkeep. A cron workflow finds claims whose window has closed and settles them, following Chainlink's Automation-to-CRE path.",
              ],
              ["World ID", "Personhood. Selfie Check proves a live human without revealing which one."],
            ].map(([name, body]) => (
              <div key={name}>
                <dt className="m-0 font-heading text-[17px]">{name}</dt>
                <dd className="m-0 mt-1.5 text-[13.5px] leading-relaxed" style={{ opacity: 0.72 }}>
                  {body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>

      {/* ── close ───────────────────────────────────────────────────────── */}
      <Reveal as="section" className="mt-16">
        <div className="card elev-md text-center" style={{ padding: "48px 28px", gap: 16 }}>
          <h2 className="m-0 mx-auto max-w-[18ch] text-[clamp(24px,4vw,34px)]">
            Escrow it once. Let the work release it.
          </h2>
          <p className="m-0 mx-auto max-w-[46ch] text-[14.5px]" style={{ opacity: 0.75 }}>
            Applications take a few minutes and a Selfie Check. Grants run on Base Sepolia testnet.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2.5">
            <Link href="/apply" className="btn-primary" style={{ fontSize: 15, padding: "12px 24px" }}>
              Apply for a grant
            </Link>
            <Link href="/verify" className="btn-secondary font-body font-semibold" style={{ fontSize: 15, padding: "12px 24px" }}>
              Try a Selfie Check
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
