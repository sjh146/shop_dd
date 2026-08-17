#!/usr/bin/env node
/**
 * e2e-backend.cjs — Full backend integration E2E against the shop_dd Go backend
 * (port 8095) + blockchain-gateway shop instance (port 8091) + ShopPayment/MockUSDC
 * contracts on Base Sepolia.
 *
 * Flow:
 *   1. Wallet auth: POST /api/auth/nonce → POST /api/auth/verify (0xdev sig) → JWT
 *   2. GET /api/products → pick first listed product
 *   3. POST /api/orders (JWT) → order_id, amount_usdc_micro, gateway_order_id
 *   4. On-chain payment (payer = test wallet):
 *        - MockUSDC.faucet(payer, amount) if balance insufficient (deployer signs)
 *        - MockUSDC.approve(ShopPayment, amount_usdc_micro)
 *        - ShopPayment.pay(gateway_order_id, amount_usdc_micro)
 *   5. POST /api/orders/:id/verify (JWT) → status=paid + tx_hash
 *   6. Write evidence to .omo/evidence/p4-backend-e2e.txt (NO secrets)
 *
 * Run:
 *   set -a; source ~/contracts/.env; set +a
 *   NODE_PATH=/home/dduckbeagy/blockchain-gateway/node_modules node tests/e2e-backend.cjs
 *
 * Requires (env):
 *   PRIVATE_KEY  — deployer/operator private key (sourced from ~/contracts/.env)
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
} = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");

// ── Configuration ────────────────────────────────────────────────────────────
const RPC_URL = "https://sepolia.base.org";
const BACKEND_URL = "http://localhost:8095";
const CHAIN = baseSepolia;

// Contract addresses (from contracts/deployed-base-sepolia.json)
const SHOP_PAYMENT = "0x7fD9208e601c69639F6875EC24717e8476A2cCb1";
const MOCK_USDC = "0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90";
const TREASURY = "0x519c8b06D8E57969B4886e1028863BcDb0C425c4";

// Payer key file (reuse if present, else generate)
const PAYER_KEY_FILE = "/tmp/shop_e2e_payer.key";
// Evidence output file
const EVIDENCE_FILE = path.join(
  __dirname,
  "..",
  ".omo",
  "evidence",
  "p4-backend-e2e.txt"
);

// ── ABIs (minimal subsets, copied from e2e-gateway.cjs) ─────────────────────
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

/** POST JSON to the backend. */
async function backendPost(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** GET from the backend. */
async function backendGet(url, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "GET", headers });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const results = [];
  const log = (line) => {
    console.log(line);
    results.push(line);
  };

  // ── Load secrets (never printed) ──────────────────────────────────────────
  const deployerKey = process.env.PRIVATE_KEY;
  if (!deployerKey) {
    throw new Error(
      "PRIVATE_KEY env not set. Run: set -a; source ~/contracts/.env; set +a"
    );
  }

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

  // ── Step 2: Wallet auth ────────────────────────────────────────────────────
  step(2, "Wallet auth (nonce → verify → JWT)");

  // 2a. POST /api/auth/nonce
  const nonceRes = await backendPost(`${BACKEND_URL}/api/auth/nonce`, {
    walletAddress: payerAddress,
  });
  ok("nonce HTTP status", nonceRes.status);
  if (nonceRes.status !== 200 || !nonceRes.json.nonce) {
    throw new Error(`nonce failed: ${JSON.stringify(nonceRes.json)}`);
  }
  const { nonce, message } = nonceRes.json;
  ok("nonce", nonce);
  ok("message", message);

  // 2b. POST /api/auth/verify — 실제 EIP-191 개인 서명 (dev 우회 제거, CWE-287)
  const signature = await payer.signMessage({ message });
  ok("signed message", `${signature.slice(0, 12)}...${signature.slice(-8)}`);
  const verifyRes = await backendPost(`${BACKEND_URL}/api/auth/verify`, {
    walletAddress: payerAddress,
    signature,
    nonce,
  });
  ok("verify HTTP status", verifyRes.status);
  if (verifyRes.status !== 200 || !verifyRes.json.token) {
    throw new Error(`verify failed: ${JSON.stringify(verifyRes.json)}`);
  }
  const token = verifyRes.json.token;
  ok("JWT token", `${token.slice(0, 20)}... (${token.length} chars)`);
  ok("auth walletAddress", verifyRes.json.walletAddress);
  ok("auth user id", verifyRes.json.user?.id);

  // ── Step 3: Product list ───────────────────────────────────────────────────
  step(3, "GET /api/products");
  const productsRes = await backendGet(`${BACKEND_URL}/api/products`);
  ok("products HTTP status", productsRes.status);
  const products = productsRes.json.products || [];
  ok("listed product count", products.length);
  if (products.length === 0) {
    throw new Error("no listed products found");
  }
  const product = products[0];
  ok("first product id", product.id);
  ok("first product title", product.title);
  ok("first product salePriceKrw", product.salePriceKrw);

  // ── Step 4: Order creation ─────────────────────────────────────────────────
  step(4, "POST /api/orders (JWT)");
  const orderRes = await backendPost(
    `${BACKEND_URL}/api/orders`,
    { items: [{ productId: product.id, qty: 1 }] },
    token
  );
  ok("order HTTP status", orderRes.status);
  if (orderRes.status !== 201) {
    throw new Error(`order creation failed: ${JSON.stringify(orderRes.json)}`);
  }
  const order = orderRes.json;
  ok("order_id", order.order_id);
  ok("amount_usdc_micro", order.amount_usdc_micro);
  ok("gateway_order_id", order.gateway_order_id);
  ok("contract_address", order.contract_address);
  ok("usdc_token", order.usdc_token);

  if (!order.gateway_order_id) {
    throw new Error("gateway_order_id empty — gateway register failed");
  }
  const orderId = BigInt(order.gateway_order_id);
  const amountUsdcMicro = BigInt(order.amount_usdc_micro);
  ok("on-chain orderId (BigInt)", orderId.toString());
  ok("amount to pay (micro)", amountUsdcMicro.toString());

  // ── Step 5: On-chain payment ───────────────────────────────────────────────
  step(5, "On-chain payment (faucet → approve → pay)");

  // 5a. Ensure payer has enough USDC (faucet if insufficient, deployer signs)
  const currentUsdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [payerAddress],
  });
  ok("payer USDC balance", `${currentUsdc} (${Number(currentUsdc) / 1e6} mUSDC)`);

  let faucetTx;
  if (currentUsdc >= amountUsdcMicro) {
    warn("payer USDC sufficient — skipping faucet mint");
  } else {
    const faucetAmount = amountUsdcMicro * 2n; // mint 2x to leave margin
    try {
      faucetTx = await deployerClient.writeContract({
        address: MOCK_USDC,
        abi: MOCK_USDC_ABI,
        functionName: "faucet",
        args: [payerAddress, faucetAmount],
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

  // 5b. Ensure payer has ETH for gas (fund if insufficient)
  const ETH_FUNDING = 1000000000000000n; // 0.001 ETH
  const currentEth = await publicClient.getBalance({ address: payerAddress });
  ok("payer ETH balance", `${currentEth} wei (${Number(currentEth) / 1e18} ETH)`);
  if (currentEth < ETH_FUNDING) {
    try {
      const ethTx = await deployerClient.sendTransaction({
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
  } else {
    warn("payer ETH sufficient — skipping ETH transfer");
  }

  // 5c. MockUSDC.approve(ShopPayment, amount_usdc_micro)
  const allowance = await publicClient.readContract({
    address: MOCK_USDC,
    abi: MOCK_USDC_ABI,
    functionName: "allowance",
    args: [payerAddress, SHOP_PAYMENT],
  });
  ok("current allowance", allowance.toString());

  let approveTx;
  if (allowance >= amountUsdcMicro) {
    warn("allowance already sufficient — skipping approve");
  } else {
    try {
      approveTx = await payerClient.writeContract({
        address: MOCK_USDC,
        abi: MOCK_USDC_ABI,
        functionName: "approve",
        args: [SHOP_PAYMENT, amountUsdcMicro],
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

  // 5d. Wait for order registration to be mined (orderAmount > 0)
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

  // 5e. Check if already paid (idempotent-ish)
  const alreadyProcessed = await publicClient.readContract({
    address: SHOP_PAYMENT,
    abi: SHOP_PAYMENT_ABI,
    functionName: "processedOrderIds",
    args: [orderId],
  });
  ok("processedOrderIds (before pay)", alreadyProcessed.toString());

  // 5f. ShopPayment.pay(gateway_order_id, amount_usdc_micro)
  let payTx;
  if (alreadyProcessed) {
    warn("order already paid on-chain — skipping pay");
  } else {
    try {
      payTx = await payerClient.writeContract({
        address: SHOP_PAYMENT,
        abi: SHOP_PAYMENT_ABI,
        functionName: "pay",
        args: [orderId, amountUsdcMicro],
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
      throw new Error(`pay failed: ${e.shortMessage ?? e.message}`);
    }
  }

  // 5g. Wait for RPC indexing — re-check processedOrderIds
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
  ok("processedOrderIds (after pay)", processed.toString());

  // ── Step 6: Verify ─────────────────────────────────────────────────────────
  step(6, "POST /api/orders/:id/verify (JWT)");
  const verifyOrderRes = await backendPost(
    `${BACKEND_URL}/api/orders/${order.order_id}/verify`,
    {},
    token
  );
  ok("verify HTTP status", verifyOrderRes.status);
  ok("verify response", JSON.stringify(verifyOrderRes.json));

  const vOrder = verifyOrderRes.json.order;
  if (!vOrder) {
    throw new Error(`verify response missing order: ${JSON.stringify(verifyOrderRes.json)}`);
  }
  ok("order status", vOrder.status);
  ok("order txHash", vOrder.txHash || "(none)");
  ok("order gatewayOrderId", vOrder.gatewayOrderId);

  if (vOrder.status !== "paid") {
    throw new Error(`order status is ${vOrder.status}, expected paid`);
  }
  if (!vOrder.txHash) {
    throw new Error("order has no tx_hash");
  }

  // ── Step 7: Balance checks ─────────────────────────────────────────────────
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
  ok("payer USDC (after)", `${finalPayerUsdc} (${Number(finalPayerUsdc) / 1e6} mUSDC)`);
  ok("ShopPayment USDC", `${shopUsdc} (${Number(shopUsdc) / 1e6} mUSDC)`);
  ok("Treasury USDC", `${treasuryUsdc} (${Number(treasuryUsdc) / 1e6} mUSDC)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("E2E BACKEND FLOW COMPLETE");
  console.log("  payer:          ", payerAddress);
  console.log("  product_id:     ", product.id);
  console.log("  order_id:       ", order.order_id);
  console.log("  amount_usdc:    ", amountUsdcMicro.toString());
  console.log("  gateway_order:  ", order.gateway_order_id);
  console.log("  faucet_tx:      ", faucetTx ?? "n/a");
  console.log("  approve_tx:     ", approveTx ?? "n/a");
  console.log("  pay_tx:         ", payTx ?? vOrder.txHash ?? "n/a");
  console.log("  order_status:   ", vOrder.status);
  console.log("  tx_hash:        ", vOrder.txHash);
  console.log("══════════════════════════════════════════════════════════");

  // ── Write evidence (NO secrets) ────────────────────────────────────────────
  const evidence = [
    "================================================================================",
    "P4 — Backend Integration E2E Evidence (shop_dd :8095 + gateway :8091 + Base Sepolia)",
    "================================================================================",
    `Date:            ${new Date().toISOString()}`,
    `Backend:         ${BACKEND_URL}`,
    `Gateway:         http://localhost:8091`,
    `RPC:             ${RPC_URL}`,
    `Chain:           Base Sepolia (${CHAIN.id})`,
    "",
    "Flow: wallet auth → product list → order create → on-chain pay → verify",
    "",
    "── Step 1: Payer wallet ──────────────────────────────────────────────",
    `  payer address:  ${payerAddress}`,
    `  payer key file: ${PAYER_KEY_FILE} (reused)`,
    "",
    "── Step 2: Wallet auth ───────────────────────────────────────────────",
    `  nonce HTTP:     ${nonceRes.status}`,
    `  nonce:          ${nonce}`,
    `  verify HTTP:    ${verifyRes.status}`,
    `  JWT token:      ${token.slice(0, 20)}... (${token.length} chars)`,
    `  auth wallet:    ${verifyRes.json.walletAddress}`,
    `  auth user id:   ${verifyRes.json.user?.id}`,
    "",
    "── Step 3: Product list ──────────────────────────────────────────────",
    `  products HTTP:  ${productsRes.status}`,
    `  listed count:   ${products.length}`,
    `  first product:  id=${product.id} title="${product.title}" salePriceKrw=${product.salePriceKrw}`,
    "",
    "── Step 4: Order creation ────────────────────────────────────────────",
    `  order HTTP:     ${orderRes.status}`,
    `  order_id:       ${order.order_id}`,
    `  amount_usdc_micro: ${order.amount_usdc_micro}`,
    `  gateway_order_id:  ${order.gateway_order_id}`,
    `  contract_address:  ${order.contract_address}`,
    `  usdc_token:        ${order.usdc_token}`,
    "",
    "── Step 5: On-chain payment ──────────────────────────────────────────",
    `  payer USDC (before): ${currentUsdc} (${Number(currentUsdc) / 1e6} mUSDC)`,
    `  faucet_tx:      ${faucetTx ?? "n/a (skipped)"}`,
    `  approve_tx:     ${approveTx ?? "n/a (skipped)"}`,
    `  on-chain orderAmount: ${orderAmount.toString()}`,
    `  processedOrderIds (before): ${alreadyProcessed.toString()}`,
    `  pay_tx:         ${payTx ?? "n/a (already paid)"}`,
    `  processedOrderIds (after):  ${processed.toString()}`,
    "",
    "── Step 6: Verify ────────────────────────────────────────────────────",
    `  verify HTTP:    ${verifyOrderRes.status}`,
    `  order status:   ${vOrder.status}`,
    `  order txHash:   ${vOrder.txHash}`,
    `  order gatewayOrderId: ${vOrder.gatewayOrderId}`,
    "",
    "── Step 7: Balance checks ────────────────────────────────────────────",
    `  payer USDC (after):  ${finalPayerUsdc} (${Number(finalPayerUsdc) / 1e6} mUSDC)`,
    `  ShopPayment USDC:    ${shopUsdc} (${Number(shopUsdc) / 1e6} mUSDC)`,
    `  Treasury USDC:       ${treasuryUsdc} (${Number(treasuryUsdc) / 1e6} mUSDC)`,
    "",
    "── Result ────────────────────────────────────────────────────────────",
    `  E2E BACKEND FLOW: PASS (order status=${vOrder.status}, tx_hash=${vOrder.txHash})`,
    "================================================================================",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
  fs.writeFileSync(EVIDENCE_FILE, evidence);
  ok("evidence written", EVIDENCE_FILE);
}

main().catch((e) => {
  console.error("\n[FATAL]", e.message);
  process.exitCode = 1;
});
