import {
  cre,
  Runner,
  EVMClient,
  encodeCallMsg,
  bytesToHex,
  hexToBase64,
  LATEST_BLOCK_NUMBER,
  TxStatus,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";

/**
 * GrantLane settlement.
 *
 * A milestone claim is a UMA assertion with a dispute window. Once the window closes
 * undisputed, anyone may settle it — this workflow is the "anyone" that shows up on
 * time, so an applicant is not left waiting for someone to press a button.
 *
 * On every cron tick it runs GrantEscrow.checkUpkeep off-chain. If claims are ready,
 * the DON signs a report whose payload is the escrow's own performData, and the
 * SettlementReceiver hands it to performUpkeep. This is Chainlink's migration path
 * from Automation to CRE.
 *
 * The workflow decides nothing about who gets paid. performUpkeep re-checks every
 * claim on-chain and settlement goes through UMA, so the worst a faulty run can do
 * is settle what anyone could already settle, or nothing at all.
 */

type Config = {
  /** Cron schedule, 6 fields with seconds. The dispute window is 5 minutes in the demo. */
  schedule: string;
  evm: {
    /** CRE chain selector name. */
    chainSelectorName: string;
    grantEscrowAddress: Address;
    settlementReceiverAddress: Address;
    /** A full batch of 10 settlements measured ~581k gas through the real oracle. */
    gasLimit: string;
  };
};

/**
 * ReceiverContractExecutionStatus.SUCCESS from the EVM capability's protobuf. The SDK
 * exports TxStatus from its root but not this enum, so the value is pinned here.
 */
const RECEIVER_EXECUTION_SUCCESS = 0;

const ESCROW_ABI = parseAbi([
  "function checkUpkeep(bytes checkData) view returns (bool upkeepNeeded, bytes performData)",
]);

const settleExpiredClaims = (runtime: Runtime<Config>): string => {
  const { evm } = runtime.config;

  const selector =
    EVMClient.SUPPORTED_CHAIN_SELECTORS[evm.chainSelectorName as keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS];
  if (!selector) {
    throw new Error(`Unsupported chain selector name: ${evm.chainSelectorName}`);
  }
  const evmClient = new EVMClient(selector);

  // What Automation's checkUpkeep simulation used to do: which undisputed claims have
  // outlived their dispute window?
  const reply = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: evm.grantEscrowAddress,
        data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "checkUpkeep", args: ["0x"] }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  const [upkeepNeeded, performData] = decodeFunctionResult({
    abi: ESCROW_ABI,
    functionName: "checkUpkeep",
    data: bytesToHex(reply.data),
  });

  if (!upkeepNeeded) {
    runtime.log("No claims are past their dispute window.");
    return JSON.stringify({ settled: 0 });
  }

  const [assertionIds] = decodeAbiParameters([{ type: "bytes32[]" }], performData);
  runtime.log(`Settling ${assertionIds.length} claim(s): ${assertionIds.join(", ")}`);

  // The report payload is performData unchanged; SettlementReceiver passes it straight
  // to GrantEscrow.performUpkeep.
  const report = runtime
    .report({
      encodedPayload: hexToBase64(performData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const write = evmClient
    .writeReport(runtime, {
      receiver: evm.settlementReceiverAddress,
      report,
      gasConfig: { gasLimit: evm.gasLimit },
    })
    .result();

  const txHash = write.txHash ? bytesToHex(write.txHash) : "unknown";

  // The forwarder's transaction can succeed while the receiver reverts inside it, so
  // both statuses have to be checked.
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Settlement transaction failed (status ${write.txStatus}): ${write.errorMessage ?? "no detail"}; tx ${txHash}`);
  }
  if (
    write.receiverContractExecutionStatus !== undefined &&
    write.receiverContractExecutionStatus !== RECEIVER_EXECUTION_SUCCESS
  ) {
    throw new Error(`SettlementReceiver reverted inside tx ${txHash}: ${write.errorMessage ?? "no detail"}`);
  }

  runtime.log(`Settlement relayed through SettlementReceiver: ${txHash}`);
  return JSON.stringify({ settled: assertionIds.length, txHash });
};

export const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), settleExpiredClaims)];
};

/** Entry point. The CRE runtime calls this — do not invoke it here. */
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
