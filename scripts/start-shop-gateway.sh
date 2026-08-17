#!/usr/bin/env bash
#
# start-shop-gateway.sh
#
# Idempotent launcher for the blockchain-gateway "shop" instance.
# Runs the pre-built `blockchain-gateway:shop` image as a Docker container
# named `shop-gateway`, wired to the ShopPayment/MockUSDC contracts on
# Base Sepolia (chainId 84532).
#
# Secrets are referenced from env files / secret files only — this script
# contains NO hardcoded secrets.
#
#   - PRIVATE_KEY        sourced from ~/contracts/.env
#   - INTERNAL_API_KEY   read from ~/.hermes/secrets/shop_gateway_key.txt
#
# Safe to re-run: any existing `shop-gateway` container is removed first.

set -euo pipefail

# --- Load secrets from env files (never inline) ---------------------------
# PRIVATE_KEY for the operator wallet that signs gateway transactions.
set -a
# shellcheck disable=SC1091
source ~/contracts/.env
set +a

# INTERNAL_API_KEY used by shop_dd to authenticate against the gateway.
INTERNAL_API_KEY="$(cat ~/.hermes/secrets/shop_gateway_key.txt)"

# --- Remove any existing container so the script is idempotent ------------
docker rm -f shop-gateway 2>/dev/null || true

# --- Run the gateway container --------------------------------------------
docker run -d \
  --name shop-gateway \
  --restart unless-stopped \
  -p 8091:8091 \
  -e PORT=8091 \
  -e INTERNAL_API_KEY="${INTERNAL_API_KEY}" \
  -e DEV_MOCK=false \
  -e RPC_URL=https://sepolia.base.org \
  -e CHAIN_ID=84532 \
  -e PAYMENT_CONTRACT_ADDRESS=0x7fD9208e601c69639F6875EC24717e8476A2cCb1 \
  -e USDC_TOKEN_ADDRESS=0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90 \
  -e OPERATOR_PRIVATE_KEY="${PRIVATE_KEY}" \
  blockchain-gateway:shop

# --- Health check ----------------------------------------------------------
# Give the container a moment to boot, then probe /health.
sleep 5
echo "--- health check ---"
if curl -s localhost:8091/health; then
  echo
  echo "shop-gateway is healthy."
else
  echo
  echo "health check FAILED — dumping container logs:"
  docker logs shop-gateway
  exit 1
fi
