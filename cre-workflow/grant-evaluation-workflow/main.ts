import {
  cre,
  Runner,
  bytesToHex,
  hexToBase64,
  ConfidentialHTTPClient,
  EVMClient,
  HTTPCapability,
  type HTTPPayload,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";

/**
 * GrantLane milestone evaluation.
 *
 * An HTTP trigger delivers a milestone evidence bundle. The handler runs inside
 * a Nitro TEE so two things stay confidential: the reviewer rubric (a secret
 * fetched inside the enclave) and the applicant's raw evidence (fetched over
 * confidential HTTP). Only the derived verdict leaves the enclave.
 *
 * The verdict is then handed back to the DON — `usingTheDons()` — which reaches
 * consensus, signs a report, and writes it to GrantEscrow on Arc. That write is
 * what actually releases USDC, so nothing but a DON-signed report can pay out.
 */

type Config = {
  evm: {
    /** Chain selector name; "arc-testnet" resolves to 3034092155422581607. */
    chainSelectorName: string;
    /** Deployed GrantEscrow address. */
    grantEscrowAddress: string;
    gasLimit: string;
  };
  scoring: {
    /** Milestones scoring at or above this (basis points) are approved. */
    approvalThresholdBps: number;
    /** Where the enclave fetches the full evidence bundle from. */
    evidenceApiBaseUrl: string;
    /**
     * Rubric used when the CRE secret is unavailable (simulation, local runs).
     * NON-CONFIDENTIAL: it lives in a committed config file. A deployed
     * workflow should rely on the secret and leave this unset.
     */
    fallbackRubric?: string;
  };
  secrets: {
    /** Secret id holding the reviewer rubric. */
    rubricSecretId: string;
  };
};

type EvidenceBundle = {
  grantId: string;
  milestoneId: number;
  summary: string;
  artifacts: string[];
  submittedAt: string;
  evidenceHash: Hex;
};

type TriggerRequest = {
  grantId: string;
  milestoneId: number;
  evidence: EvidenceBundle;
  /**
   * The milestone's outstanding amount, in USDC base units, read from the chain
   * by the caller. Passing it in rather than reading it here keeps the workflow
   * free of ABI-decoding for a dynamic struct array. It is not a trust boundary:
   * GrantEscrow reverts with PayoutExceedsMilestone on anything larger than the
   * milestone's remaining balance, so an inflated value cannot over-pay.
   */
  payoutAmount: string;
};

type Verdict = {
  approved: boolean;
  scoreBps: number;
  payoutAmount: bigint;
};

/** Report layout GrantEscrow._processReport decodes. */
const REPORT_PARAMS = parseAbiParameters(
  "uint256 grantId, uint256 milestoneId, bool approved, uint128 payoutAmount, uint16 scoreBps",
);

function decodeTriggerInput(payload: HTTPPayload): TriggerRequest {
  const raw = payload.input;
  const text = typeof raw === "string" ? atob(raw) : new TextDecoder().decode(raw ?? new Uint8Array());
  const parsed = JSON.parse(text) as TriggerRequest;

  if (!parsed?.grantId || typeof parsed.milestoneId !== "number" || !parsed.evidence) {
    throw new Error("Trigger payload must contain grantId, milestoneId and evidence.");
  }
  if (typeof parsed.payoutAmount !== "string" || !/^\d+$/.test(parsed.payoutAmount)) {
    throw new Error("Trigger payload must contain payoutAmount as a base-10 string.");
  }
  return parsed;
}

/**
 * Scores the evidence against the rubric.
 *
 * Kept deliberately simple and deterministic: every node in the enclave has to
 * derive the same verdict from the same inputs, so nothing here may depend on
 * wall-clock time, randomness, or network order. Swap the body for an LLM call
 * over confidential HTTP if you want judgement rather than rules — but keep the
 * output shape, and keep it deterministic.
 */
function score(rubric: string, evidence: EvidenceBundle): { scoreBps: number; reasons: string[] } {
  const criteria = rubric
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const haystack = `${evidence.summary}\n${evidence.artifacts.join("\n")}`.toLowerCase();

  const reasons: string[] = [];
  let met = 0;

  for (const criterion of criteria) {
    // A criterion is "keyword: description"; the keyword is what we look for.
    const keyword = (criterion.split(":")[0] ?? criterion).trim().toLowerCase();
    if (keyword.length > 0 && haystack.includes(keyword)) {
      met += 1;
      reasons.push(`met: ${keyword}`);
    } else {
      reasons.push(`missing: ${keyword}`);
    }
  }

  // Evidence with no linked artifacts is capped — a summary alone is not proof.
  const base = criteria.length === 0 ? 0 : Math.round((met / criteria.length) * 10_000);
  const scoreBps = evidence.artifacts.length === 0 ? Math.min(base, 4_000) : base;

  return { scoreBps, reasons };
}

/**
 * Reads a CRE secret, returning null when the secrets store is not wired up.
 *
 * `getSecret` throws rather than returning undefined when no secrets file is
 * configured, which is the normal case during `cre workflow simulate`.
 */
function tryGetSecret(runtime: TeeRuntime<Config>, id: string): string | null {
  try {
    const secret = runtime.getSecret({ id }).result();
    return secret?.value ?? null;
  } catch {
    return null;
  }
}

const evaluateMilestone = async (runtime: TeeRuntime<Config>, payload: HTTPPayload): Promise<string> => {
  const request = decodeTriggerInput(payload);
  const { evm, scoring, secrets } = runtime.config;

  runtime.log(`Evaluating grant ${request.grantId} milestone ${request.milestoneId}`);

  // --- inside the enclave ------------------------------------------------
  // The rubric never leaves the TEE; neither does the raw evidence body.
  //
  // In a deployed run the rubric is a CRE secret. Simulation has no secrets
  // store, so fall back to the rubric in config — which is why `fallbackRubric`
  // is documented as NON-confidential. A deployed workflow that silently used
  // the fallback would leak the real rubric's role, so the log says which won.
  let rubric: string;
  const secretResult = tryGetSecret(runtime, secrets.rubricSecretId);
  if (secretResult !== null) {
    rubric = secretResult;
    runtime.log(`Rubric loaded from secret ${secrets.rubricSecretId}.`);
  } else if (scoring.fallbackRubric) {
    rubric = scoring.fallbackRubric;
    runtime.log("Rubric secret unavailable; using the non-confidential fallback from config.");
  } else {
    throw new Error(
      `Secret ${secrets.rubricSecretId} is unavailable and no scoring.fallbackRubric is configured.`,
    );
  }

  // Prefer the authoritative bundle the server holds; fall back to the payload.
  //
  // The whole capability call is guarded, not just the JSON parse: `.result()`
  // throws when the endpoint is unreachable (unset base URL, DNS failure), and
  // an unreachable evidence API should degrade to scoring the triggered payload
  // rather than failing the run and stranding the milestone.
  let evidence = request.evidence;
  try {
    const confidentialHttp = new ConfidentialHTTPClient();
    const evidenceResponse = confidentialHttp
      .sendRequest(runtime.usingTheDons(), {
        request: {
          url: `${scoring.evidenceApiBaseUrl.replace(/\/$/, "")}/api/milestones?grantId=${request.grantId}&milestoneId=${request.milestoneId}`,
          method: "GET",
        },
      })
      .result();

    const fetched = JSON.parse(new TextDecoder().decode(evidenceResponse.body)) as { bundle?: EvidenceBundle };
    if (fetched.bundle) {
      evidence = fetched.bundle;
      runtime.log("Evidence bundle fetched from the app server.");
    }
  } catch {
    runtime.log("Evidence API unreachable or unparseable; scoring the triggered payload.");
  }

  const { scoreBps, reasons } = score(rubric, evidence);
  const approved = scoreBps >= scoring.approvalThresholdBps;

  // Only the verdict crosses the enclave boundary — not the rubric, not the
  // evidence text, not the per-criterion reasons.
  runtime.log(`Verdict: approved=${approved} scoreBps=${scoreBps} (${reasons.length} criteria evaluated)`);

  const verdict: Verdict = {
    approved,
    scoreBps,
    // Pay the milestone out in full on approval, nothing on rejection.
    payoutAmount: approved ? BigInt(request.payoutAmount) : 0n,
  };

  // --- back out on the DON ------------------------------------------------
  const donRuntime: Runtime<Config> = runtime.usingTheDons();
  const evmClient = new EVMClient(BigInt(EVMClient.SUPPORTED_CHAIN_SELECTORS[evm.chainSelectorName as "arc-testnet"]));

  const encoded = encodeAbiParameters(REPORT_PARAMS, [
    BigInt(request.grantId),
    BigInt(request.milestoneId),
    verdict.approved,
    verdict.payoutAmount,
    verdict.scoreBps,
  ]);

  const report = donRuntime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const write = evmClient
    .writeReport(donRuntime, {
      receiver: evm.grantEscrowAddress,
      report,
      gasConfig: { gasLimit: evm.gasLimit },
    })
    .result();

  const txHash = write.txHash ? bytesToHex(write.txHash) : "unknown";
  runtime.log(`Report written to GrantEscrow: ${txHash}`);

  return JSON.stringify({
    grantId: request.grantId,
    milestoneId: request.milestoneId,
    approved: verdict.approved,
    scoreBps: verdict.scoreBps,
    txHash,
  });
};

export const initWorkflow = (_config: Config) => {
  const http = new HTTPCapability();

  return [
    cre.handlerInTee(
      http.trigger({}),
      evaluateMilestone,
      // Nitro enclave; us-west-2 is the only region the SDK currently allows.
      [{ tee: "nitro", regions: ["us-west-2"] }],
    ),
  ];
};

/** Entry point. The CRE runtime calls this — do not invoke it here. */
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
