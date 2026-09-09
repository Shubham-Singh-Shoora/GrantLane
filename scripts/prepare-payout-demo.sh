#!/usr/bin/env bash
# Prepares grant 0 / milestone 0 for a live CRE payout on Arc Testnet.
#
#   ./scripts/prepare-payout-demo.sh
#
# Two things have to be true before a CRE report can pay a milestone:
#
#  1. The milestone must be in `Submitted`. Only the grantee can do that, via
#     submitEvidence(grantId, milestoneId, evidenceHash).
#
#  2. GrantEscrow must accept the caller that delivers the report. A deployed
#     workflow arrives through the production KeystoneForwarder
#     (0x76c9cf54…5E62), but `cre workflow simulate --broadcast` arrives through
#     the tenant's MOCK forwarder. They are different addresses, so the escrow is
#     repointed here.
#
#     This is a deliberate testnet-demo step, not the production configuration.
#     Point it back with:
#       cast send $ESCROW 'setForwarderAddress(address)' $KEYSTONE_FORWARDER ...
#
# Uses `cast send` throughout: Arc's USDC blocklist precompile cannot be
# simulated locally, so forge script is unusable for anything touching USDC.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"; line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in ''|'#'*) continue;; esac
  case "$line" in 'export '*) line="${line#export }";; esac
  [[ "$line" == *=* ]] || continue
  key="${line%%=*}"; key="${key//[[:space:]]/}"
  value="${line#*=}"; value="${value#"${value%%[![:space:]]*}"}"
  case "$value" in
    \"*) value="${value#\"}"; value="${value%%\"*}";;
    \'*) value="${value#\'}"; value="${value%%\'*}";;
    *)   value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')";;
  esac
  export "$key=$value"
done < "$repo_root/.env"

: "${ARC_RPC_URL:?}"; : "${DEPLOYER_PRIVATE_KEY:?}"; : "${NEXT_PUBLIC_GRANT_ESCROW_ADDRESS:?}"
case "$DEPLOYER_PRIVATE_KEY" in 0x*) ;; *) DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY";; esac
export PATH="$HOME/.foundry/bin:$PATH"

escrow="$NEXT_PUBLIC_GRANT_ESCROW_ADDRESS"
grant="${GRANT_ID:-0}"
milestone="${MILESTONE_ID:-0}"
evidence_hash="${EVIDENCE_HASH:-0x0000000000000000000000000000000000000000000000000000000000000001}"
mock_forwarder="${MOCK_FORWARDER:-0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1}"

echo "escrow        : $escrow"
echo "grant/mstone  : $grant / $milestone"
echo "mock forwarder: $mock_forwarder"
echo

echo "1/2 submitEvidence (grantee marks the milestone Submitted)"
cast send "$escrow" 'submitEvidence(uint256,uint256,bytes32)' "$grant" "$milestone" "$evidence_hash" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json | grep -o '"transactionHash":"[^"]*"' | head -1

echo "2/2 setForwarderAddress -> mock forwarder (owner only)"
cast send "$escrow" 'setForwarderAddress(address)' "$mock_forwarder" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json | grep -o '"transactionHash":"[^"]*"' | head -1

echo
echo "milestone status (1 = Submitted): $(cast call "$escrow" 'getMilestones(uint256)((uint128,uint128,uint8,uint16,bytes32)[])' "$grant" --rpc-url "$ARC_RPC_URL")"
echo "forwarder now  : $(cast call "$escrow" 's_forwarderAddress()(address)' --rpc-url "$ARC_RPC_URL")"
