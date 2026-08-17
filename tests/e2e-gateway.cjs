#!/usr/bin/env node
/**
 * e2e-gateway.cjs — Full on-chain E2E payment flow against the blockchain-gateway
 * shop instance (port 8091) and the ShopPayment/MockUSDC contracts on Base Sepolia.
 *
 * Flow:
 *   1. Generate/reuse a random test payer wallet (key saved to /tmp/shop_e2e_payer.key)
 *   2. Fund the payer:
 *        - MockUSDC.faucet(payer, 10_000_000n)  (10 mUSDC) — deployer signs, pays gas
 *        - deployer → payer sends 0.0003 ETH (for payer's approve+pay gas)
 *   3. Gateway register: POST /internal/blockchain/payment/register
 *   4. Payer: MockUSDC.approve(ShopPayment, 2_500_000n)
 *   5. Payer: ShopPayment.pay(orderId, 2_500_000n)  — user-signed pattern
 *   6. Gateway verify: POST /internal/blockchain/payment/verify
 *   7. Check payer's MockUSDC balance / ShopPayment balance
 *   8. Print all step results (NO secrets)
 *
 * Run:
 *   set -a; source ~/contracts/.env; set +a
 *   NODE_PATH=/home/dduckbeagy/blockchain-gateway/node_modules node tests/e2e-gateway.cjs
 *
 * Requires (env):
 *   PRIVATE_KEY  — deployer/operator private key (sourced from ~/contracts/.env)
 *   INTERNAL_API_KEY is read from ~/.hermes/secrets/shop_gateway_key.txt
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseEther,
  getAddress,
} = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

// ── Configuration ────────────────────────────────────────────────────────────
const RPC_URL = "https://sepolia.base.org";
const GATEWAY_URL = "http://localhost:8091";
const CHAIN = baseSepolia;

const REFERENCE_ID = "e2e-order-1";
const AMOUNT_USDC = "2500000"; // 2.5 mUSDC (micro units, 6 decimals)
const AMOUNT_USDC_BIG = 2_500_000n;
const FAUCET_AMOUNT = 10_000_000n; // 10 mUSDC
const ETH_FUNDING = parseEther("0.0003"); // payer gas for approve + pay

// Contract addresses (from contracts/deployed-base-sepolia.json)
const SHOP_PAYMENT = "0x7fD9208e601c69639F6875EC24717e8476A2cCb1";
const MOCK_USDC = "0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90";
const TREASURY = "0x519c8b06D8E57969B4886e1028863BcDb0C425c4";

// Payer key file (reuse if present, else generate)
const PAYER_KEY_FILE = "/tmp/shop_e2e_payer.key";
// Gateway internal API key file
const GATEWAY_KEY_FILE = path.join(os.homedir(), ".hermes", "secrets", "shop_gateway_key.txt");

// ── ABIs (minimal subsets) ───────────────────────────────────────────────────
const SHOP_PAYMENT_ABI = [
  {
    type: "function",
    name: "registerOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "amountUsdc", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "amountUsdc", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "processedOrderIds",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "orderAmount",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "orderPayer",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
];

const MOCK_USDC_ABI = [
  {
    type: "function",
    name: "faucet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(n, title) {
  console.log(`\n─── Step ${n}: ${title} ───`);
}

function ok(label, value) {
  console.log(`  ✓ ${label}: ${value}`);
}

function warn(label, value) {
  console.log(`  ⚠ ${label}: ${value}`);
}

function fail(label, value) {
  console.log(`  ✗ ${label}: ${value}`);
}

/** Compute deterministic orderId from reference_id (matches gateway PaymentVerifier). */
function computeOrderId(referenceId) {
  return BigInt(keccak256(toHex(referenceId)));
}

/** Read a file, trimming whitespace. Throws if missing. */
function readSecret(file, label) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (e) {
    throw new Error(`Cannot read ${label} from ${file}: ${e.message}`);
  }
}

/** POST JSON to the gateway with the internal API key. */
async function gatewayPost(client, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": client.apiKey,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/**
 * Step 6 + Step 7 + summary — reusable for both the normal flow and the
 * already-paid early-return path.
 *
 * @param {object} ctx
 * @param {object} ctx.publicClient  viem public client
 * @param {string} ctx.apiKey        gateway internal API key
 * @param {string} ctx.payerAddress  payer address
 * @param {bigint} ctx.orderId       on-chain orderId
 * @param {bigint} ctx.payerUsdc     payer USDC balance BEFORE payment (for delta)
 * @param {object} [ctx.txs]         optional tx hashes for the summary
 * @returns {Promise<object>} the gateway verify response JSON
 */
async function verifyAndReport({
  publicClient,
  apiKey,
  payerAddress,
  orderId,
  payerUsdc,
  txs = {},
}) {
  // ── Step 6: Gateway verify ───────────────────────────────────────────────
  step(6, "Gateway verify");

  // RPC indexing delay — re-check processedOrderIds after a few seconds.
  let processed = false;
  for (let i = 0; i < 10; i++) {
    processed = await publicClient.readContract({
      address: SHOP_PAYMENT,
      abi: SHOP_PAYMENT_ABI,
      functionName: "processedOrderIds",
      args: [orderId],
    });
    if (processed) break;
    await sleep(3000);
  }
  ok("processedOrderIds", processed.toString());

  const verifyRes = await gatewayPost(
    { apiKey },
    `${GATEWAY_URL}/internal/blockchain/payment/verify`,
    { reference_id: REFERENCE_ID }
  );
  ok("verify HTTP status", verifyRes.status);
  ok("verify response", JSON.stringify(verifyRes.json));

  const v = verifyRes.json;
  if (v.verified === true) {
    ok("verified", true);
    ok("payer", v.payer);
    ok("amount_usdc", v.amount_usdc);
    ok("tx_hash", v.tx_hash);
    if (getAddress(v.payer) !== payerAddress) {
      fail("payer match", `expected ${payerAddress}, got ${v.payer}`);
    } else {
      ok("payer matches", payerAddress);
    }
    if (v.amount_usdc !== AMOUNT_USDC) {
      fail("amount match", `expected ${AMOUNT_USDC}, got ${v.amount_usdc}`);
    } else {
      ok("amount matches", AMOUNT_USDC);
    }
    if (!v.tx_hash) {
      fail("tx_hash present", "missing");
    } else {
      ok("tx_hash present", v.tx_hash);
    }
  } else {
    fail("verified", v.verified ?? false);
    warn("verify reason", v.reason ?? "n/a");
  }

  // ── Step 7: Balance checks ───────────────────────────────────────────────
  step(7, "Balance checks");
  const finalPayerUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [payerAddress],
  });
  const shopUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [SHOP_PAYMENT],
  });
  const treasuryUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [TREASURY],
  });

  ok("payer USDC (before)", `${payerUsdc} (${Number(payerUsdc) / 1e6} mUSDC)`);
  ok("payer USDC (after)", `${finalPayerUsdc} (${Number(finalPayerUsdc) / 1e6} mUSDC)`);
  ok("ShopPayment USDC", `${shopUsdc} (${Number(shopUsdc) / 1e6} mUSDC)`);
  ok("Treasury USDC", `${treasuryUsdc} (${Number(treasuryUsdc) / 1e6} mUSDC)`);

  const expectedPayer = FAUCET_AMOUNT - AMOUNT_USDC_BIG; // 10e6 - 2.5e6 = 7.5e6
  if (finalPayerUsdc === expectedPayer) {
    ok("payer balance delta", `10e6 → 7.5e6 (${finalPayerUsdc})`);
  } else {
    warn("payer balance delta", `expected ${expectedPayer}, got ${finalPayerUsdc}`);
  }
  if (treasuryUsdc === AMOUNT_USDC_BIG) {
    ok("treasury received", `${AMOUNT_USDC_BIG} (2.5 mUSDC)`);
  } else {
    warn("treasury received", `expected ${AMOUNT_USDC_BIG}, got ${treasuryUsdc}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("E2E GATEWAY FLOW COMPLETE");
  console.log("  payer:        ", payerAddress);
  console.log("  order_id:     ", orderId.toString());
  console.log("  reference_id: ", REFERENCE_ID);
  console.log("  amount_usdc:  ", AMOUNT_USDC);
  console.log("  faucet_tx:    ", txs.faucetTx ?? "n/a");
  console.log("  eth_fund_tx:  ", txs.ethTx ?? "n/a");
  console.log("  approve_tx:   ", txs.approveTx ?? "n/a");
  console.log("  pay_tx:       ", v.tx_hash ?? "n/a");
  console.log("  verified:     ", v.verified ?? false);
  console.log("══════════════════════════════════════════════════════════");

  return v;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── Load secrets (never printed) ──────────────────────────────────────────
  const deployerKey = process.env.PRIVATE_KEY;
  if (!deployerKey) {
    throw new Error(
      "PRIVATE_KEY env not set. Run: set -a; source ~/contracts/.env; set +a"
    );
  }
  const apiKey = readSecret(GATEWAY_KEY_FILE, "gateway internal API key");

  // ── Clients ────────────────────────────────────────────────────────────────
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const deployer = privateKeyToAccount(deployerKey);
  const deployerClient = createWalletClient({
    account: deployer,
    chain: CHAIN,
    transport: http(RPC_URL),
  });

  // ── Step 1: Payer wallet ───────────────────────────────────────────────────
  step(1, "Payer wallet");
  let payerKey;
  if (fs.existsSync(PAYER_KEY_FILE)) {
    payerKey = fs.readFileSync(PAYER_KEY_FILE, "utf8").trim();
    ok("reused existing payer key", PAYER_KEY_FILE);
  } else {
    payerKey = generatePrivateKey();
    fs.writeFileSync(PAYER_KEY_FILE, payerKey, { mode: 0o600 });
    ok("generated new payer key", PAYER_KEY_FILE);
  }
  const payer = privateKeyToAccount(payerKey);
  const payerAddress = getAddress(payer.address);
  ok("payer address", payerAddress);
  const payerClient = createWalletClient({
    account: payer,
    chain: CHAIN,
    transport: http(RPC_URL),
  });

  // ── Step 2: Fund the payer ─────────────────────────────────────────────────
  step(2, "Fund payer");

  // 2a. MockUSDC.faucet(payer, 10_000_000n) — deployer signs, pays gas.
  //     Idempotent: skip if payer already has >= FAUCET_AMOUNT (re-run safety).
  let faucetTx;
  const currentUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [payerAddress],
  });
  if (currentUsdc >= FAUCET_AMOUNT) {
    warn("payer USDC already >= faucet amount — skipping faucet mint");
  } else {
    try {
      faucetTx = await deployerClient.writeContract({
        address: MOCK_USDC,
        abi: MOCK_USDC_ABI,
        functionName: "faucet",
        args: [payerAddress, FAUCET_AMOUNT],
        account: deployer,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: faucetTx,
        timeout: 90_000,
      });
      if (receipt.status !== "success") {
        throw new Error("faucet tx reverted");
      }
      ok("faucet tx", faucetTx);
    } catch (e) {
      fail("faucet", e.shortMessage ?? e.message);
      // Continue — payer may already have funds from a prior run.
    }
  }

  // 2b. deployer → payer sends 0.0003 ETH (payer gas for approve + pay).
  //     Idempotent: skip if payer already has >= ETH_FUNDING.
  let ethTx;
  const currentEth = await publicClient.getBalance({ address: payerAddress });
  if (currentEth >= ETH_FUNDING) {
    warn("payer ETH already >= funding amount — skipping ETH transfer");
  } else {
    try {
      ethTx = await deployerClient.sendTransaction({
        to: payerAddress,
        value: ETH_FUNDING,
        account: deployer,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: ethTx,
        timeout: 90_000,
      });
      if (receipt.status !== "success") {
        throw new Error("ETH transfer reverted");
      }
      ok("ETH funding tx", ethTx);
    } catch (e) {
      fail("ETH funding", e.shortMessage ?? e.message);
    }
  }

  // Verify payer has USDC + ETH
  const payerUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [payerAddress],
  });
  const payerEth = await publicClient.getBalance({ address: payerAddress });
  ok("payer USDC balance", `${payerUsdc} (${Number(payerUsdc) / 1e6} mUSDC)`);
  ok("payer ETH balance", `${payerEth} wei (${Number(payerEth) / 1e18} ETH)`);

  // ── Step 3: Gateway register ───────────────────────────────────────────────
  step(3, "Gateway register");
  const orderId = computeOrderId(REFERENCE_ID);
  ok("computed orderId", orderId.toString());

  const registerRes = await gatewayPost(
    { apiKey },
    `${GATEWAY_URL}/internal/blockchain/payment/register`,
    {
      reference_id: REFERENCE_ID,
      wallet_address: payerAddress,
      amount_usdc: AMOUNT_USDC,
    }
  );
  ok("register HTTP status", registerRes.status);
  ok("register response", JSON.stringify(registerRes.json));

  if (registerRes.json.ok !== true) {
    // If already registered, that's fine (idempotent-ish). If onchain failed, abort.
    if (registerRes.json.error) {
      fail("register", registerRes.json.error);
      // Check if order already exists on-chain (prior run) — if so, continue.
      const processed = await publicClient.readContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "processedOrderIds",
        args: [orderId],
      });
      const orderPayer = await publicClient.readContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "orderPayer",
        args: [orderId],
      });
      if (processed) {
        warn("order already paid on-chain — skipping pay step");
        return await verifyAndReport({
          publicClient,
          apiKey,
          payerAddress,
          orderId,
          payerUsdc,
          txs: { faucetTx, ethTx },
        });
      }
      if (orderPayer !== "0x0000000000000000000000000000000000000000") {
        warn("order already registered on-chain — proceeding to pay");
      } else {
        throw new Error(`register failed: ${registerRes.json.error}`);
      }
    }
  }

  // ── Step 4: Payer approves ShopPayment ─────────────────────────────────────
  step(4, "Payer approve MockUSDC → ShopPayment");
  const allowance = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "allowance",
    args: [payerAddress, SHOP_PAYMENT],
  });
  ok("current allowance", allowance.toString());

  let approveTx;
  if (allowance >= AMOUNT_USDC_BIG) {
    warn("allowance already sufficient — skipping approve");
  } else {
    try {
      approveTx = await payerClient.writeContract({
        address: MOCK_USDC,
        abi: MOCK_USDC_ABI,
        functionName: "approve",
        args: [SHOP_PAYMENT, AMOUNT_USDC_BIG],
        account: payer,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: approveTx,
        timeout: 90_000,
      });
      if (receipt.status !== "success") {
        throw new Error("approve tx reverted");
      }
      ok("approve tx", approveTx);
    } catch (e) {
      fail("approve", e.shortMessage ?? e.message);
      throw new Error(`approve failed: ${e.shortMessage ?? e.message}`);
    }
  }

  // ── Step 5: Payer pays (user-signed pattern) ───────────────────────────────
  step(5, "Payer ShopPayment.pay(orderId, amount)");

  // Wait for order registration to be mined (orderAmount > 0) — RPC indexing delay.
  let orderAmount = 0n;
  for (let i = 0; i < 20; i++) {
    orderAmount = await publicClient.readContract({
      address: SHOP_PAYMENT,
      abi: SHOP_PAYMENT_ABI,
      functionName: "orderAmount",
      args: [orderId],
    });
    if (orderAmount > 0n) break;
    await sleep(2000);
  }
  ok("on-chain orderAmount", orderAmount.toString());
  if (orderAmount <= 0n) {
    throw new Error("order not registered on-chain yet (orderAmount=0)");
  }

  // Check if already paid (idempotent-ish)
  const alreadyProcessed = await publicClient.readContract({
    address: SHOP_PAYMENT,
    abi: SHOP_PAYMENT_ABI,
    functionName: "processedOrderIds",
    args: [orderId],
  });
  if (alreadyProcessed) {
    warn("order already paid on-chain — skipping pay");
  } else {
    try {
      const payTx = await payerClient.writeContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "pay",
        args: [orderId, AMOUNT_USDC_BIG],
        account: payer,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: payTx,
        timeout: 90_000,
      });
      if (receipt.status !== "success") {
        throw new Error("pay tx reverted");
      }
      ok("pay tx", payTx);
    } catch (e) {
      fail("pay", e.shortMessage ?? e.message);
      // Diagnose: re-check allowance, order state.
      const diagAllowance = await publicClient.readContract({
        address: MOCK_USDC,
        abi: MOCK_USDC_ABI,
        functionName: "allowance",
        args: [payerAddress, SHOP_PAYMENT],
      });
      const diagPayer = await publicClient.readContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "orderPayer",
        args: [orderId],
      });
      const diagAmount = await publicClient.readContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "orderAmount",
        args: [orderId],
      });
      warn("diagnostic allowance", diagAllowance.toString());
      warn("diagnostic orderPayer", diagPayer);
      warn("diagnostic orderAmount", diagAmount.toString());
      throw new Error(`pay failed: ${e.shortMessage ?? e.message}`);
    }
  }

  // ── Step 6 + Step 7 + summary (reusable) ───────────────────────────────────
  await verifyAndReport({
    publicClient,
    apiKey,
    payerAddress,
    orderId,
    payerUsdc,
    txs: { faucetTx, ethTx, approveTx },
  });
}

main().catch((e) => {
  console.error("\n[FATAL]", e.message);
  process.exitCode = 1;
});
