#!/usr/bin/env bash
# Deploys GrantEscrow to Arc Testnet from WSL.
#
#   ./scripts/deploy-arc.sh            # simulate only (no broadcast)
#   ./scripts/deploy-arc.sh --broadcast
#
# Reads the repo-root .env. Foundry only auto-loads a .env from its own project
# directory, and this repo keeps one at the root, so the values are exported here
# explicitly. Inline `# comments`, quotes and `export ` prefixes are stripped the
# same way apps/web/load-env.mjs does it, so both readers agree on every value.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"

[ -f "$env_file" ] || { echo "No .env at $env_file (copy .env.example)." >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"                       # tolerate CRLF
  line="${line#"${line%%[![:space:]]*}"}"    # ltrim
  case "$line" in ''|'#'*) continue;; esac
  case "$line" in 'export '*) line="${line#export }";; esac
  [[ "$line" == *=* ]] || continue

  key="${line%%=*}"; key="${key//[[:space:]]/}"
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"

  case "$value" in
    \"*) value="${value#\"}"; value="${value%%\"*}";;
    \'*) value="${value#\'}"; value="${value%%\'*}";;
    *)   value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')";;
  esac

  export "$key=$value"
done < "$env_file"

: "${ARC_RPC_URL:?ARC_RPC_URL is not set}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is not set}"
: "${KEYSTONE_FORWARDER:?KEYSTONE_FORWARDER is not set}"
: "${ATTESTOR_ADDRESS:?ATTESTOR_ADDRESS is not set}"

# forge wants an 0x-prefixed key; the .env may hold it bare.
case "$DEPLOYER_PRIVATE_KEY" in 0x*) ;; *) DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY";; esac

export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null || { echo "forge not on PATH — install Foundry in WSL." >&2; exit 1; }

echo "RPC        : $ARC_RPC_URL"
echo "forwarder  : $KEYSTONE_FORWARDER"
echo "attestor   : $ATTESTOR_ADDRESS"
echo "escrow ERC20: ${NEXT_PUBLIC_USDC_ADDRESS:-<unset>}"
echo

cd "$repo_root/contracts"
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  "$@"
