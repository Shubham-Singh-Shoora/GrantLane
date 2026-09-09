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

const evaluateMilestone = async (runtime: TeeRuntime<Config>, payload: HTTPPayload): Promise<string> => {
  const request = decodeTriggerInput(payload);
  const { evm, scoring, secrets } = runtime.config;

  runtime.log(`Evaluating grant ${request.grantId} milestone ${request.milestoneId}`);

  // --- inside the enclave ------------------------------------------------
  // The rubric never leaves the TEE; neither does the raw evidence body.
  const rubric = runtime.getSecret({ id: secrets.rubricSecretId }).result();

  const confidentialHttp = new ConfidentialHTTPClient();
  const evidenceResponse = confidentialHttp
    .sendRequest(runtime.usingTheDons(), {
      request: {
        url: `${scoring.evidenceApiBaseUrl.replace(/\/$/, "")}/api/milestones?grantId=${request.grantId}&milestoneId=${request.milestoneId}`,
        method: "GET",
      },
    })
    .result();

  // Prefer the authoritative bundle the server holds; fall back to the payload.
  let evidence = request.evidence;
  try {
    const fetched = JSON.parse(new TextDecoder().decode(evidenceResponse.body)) as { bundle?: EvidenceBundle };
    if (fetched.bundle) evidence = fetched.bundle;
  } catch {
    runtime.log("Could not parse evidence API response; scoring the triggered payload.");
  }

  const { scoreBps, reasons } = score(rubric.value ?? "", evidence);
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

export async function main() {
  const runner = await Runner.newRunner<Config>();

  await runner.run((config) => {
    const http = new HTTPCapability();

    return [
      cre.handlerInTee(
        http.trigger({}),
        evaluateMilestone,
        // Nitro enclave; us-west-2 is the only region the SDK currently allows.
        [{ tee: "nitro", regions: ["us-west-2"] }],
      ),
    ];
  });
}

main();
