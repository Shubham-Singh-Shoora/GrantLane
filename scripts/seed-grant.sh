#!/usr/bin/env bash
# Creates a demo grant on a deployed GrantEscrow (Arc Testnet).
#
#   ./scripts/seed-grant.sh                     # grantee = funder, 1.0 USDC over 2 milestones
#   GRANTEE=0xabc... ./scripts/seed-grant.sh
#   M0=600000 M1=400000 ./scripts/seed-grant.sh  # base units (6 decimals)
#
# Why `cast send` and not `forge script`:
#
# Arc's USDC (0x3600…0000) checks a blocklist precompile at 0x1800…0001 on every
# transfer. That precompile is native — its "bytecode" is the stub 0x01 — so
# Foundry's local REVM cannot execute it and any transferFrom reverts with
# StackUnderflow during simulation. `forge script` always executes locally to
# collect the transactions it will broadcast, so it fails before sending
# anything, and --skip-simulation does not change that. `cast send` estimates gas
# on the node itself, where the precompile is real, so it works.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
[ -f "$env_file" ] || { echo "No .env at $env_file" >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
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
done < "$env_file"

: "${ARC_RPC_URL:?}"; : "${DEPLOYER_PRIVATE_KEY:?}"
: "${NEXT_PUBLIC_GRANT_ESCROW_ADDRESS:?}"; : "${NEXT_PUBLIC_USDC_ADDRESS:?}"
case "$DEPLOYER_PRIVATE_KEY" in 0x*) ;; *) DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY";; esac

export PATH="$HOME/.foundry/bin:$PATH"
escrow="$NEXT_PUBLIC_GRANT_ESCROW_ADDRESS"
usdc="$NEXT_PUBLIC_USDC_ADDRESS"
funder="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
grantee="${GRANTEE:-$funder}"
m0="${M0:-600000}"
m1="${M1:-400000}"
total=$(( m0 + m1 ))

decimals="$(cast call "$usdc" 'decimals()(uint8)' --rpc-url "$ARC_RPC_URL")"
[ "$decimals" = "6" ] || { echo "escrow token reports $decimals decimals, expected 6" >&2; exit 1; }

echo "escrow  : $escrow"
echo "token   : $usdc (6 dp)"
echo "funder  : $funder"
echo "grantee : $grantee"
echo "amounts : $m0 + $m1 = $total base units"
echo

echo "1/2 approve..."
cast send "$usdc" 'approve(address,uint256)' "$escrow" "$total" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json | grep -o '"transactionHash":"[^"]*"'

echo "2/2 createGrant..."
cast send "$escrow" 'createGrant(address,address,uint128[])' "$grantee" "$usdc" "[$m0,$m1]" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json | grep -o '"transactionHash":"[^"]*"'

echo
echo "nextGrantId    : $(cast call "$escrow" 'nextGrantId()(uint256)' --rpc-url "$ARC_RPC_URL")"
echo "escrow balance : $(cast call "$usdc" 'balanceOf(address)(uint256)' "$escrow" --rpc-url "$ARC_RPC_URL") base units"
