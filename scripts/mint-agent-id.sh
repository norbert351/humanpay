#!/usr/bin/env bash
# Mint a fresh ERC-8004 Agent ID on Celo mainnet for HumanPay's ROTATED operator
# wallet, then print the IDs needed for the hackathon `erc8004Url` field.
#
# WHY a fresh mint: the original Celo agent ID #9813 is owned by 0x73b1…4539,
# which was compromised and rotated off. The submission's erc8004Url must be an
# agent identity the registered agent wallet actually holds.
#
# PREREQ: the operator wallet 0x10b4…A4A6 needs ≥ ~0.05 CELO for gas.
#         Check: cast balance 0x10b4064504D3d0D400A607164190B04dE679A4A6 --rpc-url https://forno.celo.org
#         This wallet had 0 CELO / 0 txcount as of 2026-09-12 — FUND IT FIRST or this reverts.
#
# USAGE: OP_OPERATOR_PK=<0x…private key of 0x10b4…A4A6> ./scripts/mint-agent-id.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
RPC=https://forno.celo.org
CARD=https://raw.githubusercontent.com/norbert351/humanpay/main/agents/humanpay.json

: "${OP_OPERATOR_PK:?set OP_OPERATOR_PK to the rotated operator key (0x10b4…A4A6)}"
WALLET=$(cast wallet address --private-key "$OP_OPERATOR_PK")

echo "== preflight =="
BAL=$(cast balance "$WALLET" --rpc-url "$RPC")
NONCE=$(cast nonce "$WALLET" --rpc-url "$RPC")
echo "wallet : $WALLET"
echo "balance: $BAL wei"
echo "nonce  : $NONCE"
if [ "$BAL" = "0" ]; then
  echo "REFUSING: wallet has 0 CELO — the register() tx will revert. Fund it with CELO first." >&2
  exit 1
fi

echo "== card reachable? =="
code=$(curl -s -o /dev/null -w '%{http_code}' "$CARD")
echo "GET $CARD -> $code"
[ "$code" = "200" ] || { echo "REFUSING: agent card not reachable (need 200)" >&2; exit 1; }

echo "== minting =="
cast send "$REGISTRY" 'register(string)' "$CARD" \
  --private-key "$OP_OPERATOR_PK" --rpc-url "$RPC"

echo
echo "== after the mint =="
echo "Check ownership of the newest id, then set the form values:"
echo "  cast call $REGISTRY 'ownerOf(uint256)(address)' <NEW_ID> --rpc-url $RPC"
echo "  erc8004Url      = https://8004scan.io/agents/celo/<NEW_ID>"
echo "  agentWalletAddress = $WALLET"
echo "Extract <NEW_ID> from the Registered event (first indexed topic) in the tx receipt."
