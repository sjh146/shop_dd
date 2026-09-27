// viem wallet helpers — desktop extension (window.ethereum) + WalletConnect QR (mobile).
// The MetaMask SDK relay was removed earlier (lost responses after signing); the standard
// WalletConnect path is used instead.
import { EthereumProvider } from '@walletconnect/ethereum-provider'
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient
} from 'viem'
import { BRAND, BRAND_DESCRIPTION, CHAIN_ID, CHAIN_NAME, EXPLORER_URL, TESTNET } from './config'

// Re-exported so wallet consumers can import the chain constants from one place
export { CHAIN_ID, CHAIN_NAME }

// WalletConnect Cloud project ID (create one at https://cloud.walletconnect.com — public client ID)
const WALLETCONNECT_PROJECT_ID = 'PENDING_USER_PROJECT_ID'

declare global {
  interface Window {
    ethereum?: unknown
  }
}

/** Payment chain (Base Sepolia while TESTNET, Base mainnet when live). */
export const paymentChain: Chain = {
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [TESTNET ? 'https://sepolia.base.org' : 'https://mainnet.base.org'] }
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: EXPLORER_URL }
  }
}

/**
 * Official deep link that opens this page inside the MetaMask mobile in-app browser
 * (instead of asking the user to find Explore → Browser).
 */
export function metamaskDeeplink(): string {
  const host = typeof window !== 'undefined' ? window.location.host : ''
  return `https://link.metamask.io/dapp/${host}`
}

/** Mobile browser (Android/iOS)? */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * When there is no injected wallet and we are on a mobile browser, hand the user off to
 * the MetaMask in-app browser. Returns true when navigation started.
 * Synchronous check — universal links only open inside a click gesture.
 * (Once a WalletConnect projectId is configured, prefer that path instead.)
 */
export function maybeOpenInMetaMaskApp(): boolean {
  if (typeof window === 'undefined') return false
  if (!isMobileDevice()) return false
  if (extensionProvider()) return false
  window.location.href = metamaskDeeplink()
  return true
}

/** Already-authorised account, silently (eth_accounts — no popup). null when none. */
export async function getExistingAccount(): Promise<Address | null> {
  const provider = extensionProvider()
  if (!provider) return null
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as Address[]
    return accounts[0] ?? null
  } catch {
    return null
  }
}

/** USDC allowance — lets checkout skip the approve step when it is already sufficient. */
export async function getAllowance(
  token: Address,
  owner: Address,
  spender: Address
): Promise<bigint> {
  const result = await getPublicClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender]
  })
  return result as bigint
}

// Minimal ABIs (only the functions we call). USDC and the mock token share the ERC-20 subset.
const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'faucet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const

const shopPaymentAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'amountUsdc', type: 'uint256' }
    ],
    outputs: []
  },
  // Custom errors — needed to decode the revert reason in pre-flight simulation
  { type: 'error', name: 'OrderNotRegistered', inputs: [{ name: 'orderId', type: 'uint256' }] },
  { type: 'error', name: 'NotOrderPayer', inputs: [{ name: 'orderId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'AmountMismatch',
    inputs: [{ name: 'expected', type: 'uint256' }, { name: 'actual', type: 'uint256' }]
  },
  { type: 'error', name: 'OrderAlreadyPaid', inputs: [{ name: 'orderId', type: 'uint256' }] }
] as const

let publicClient: PublicClient | null = null
let wcProvider: EIP1193Provider | null = null
let wcInitPromise: Promise<EIP1193Provider | null> | null = null
let activeProvider: EIP1193Provider | null = null

function extensionProvider(): EIP1193Provider | null {
  return (window.ethereum as EIP1193Provider | undefined) ?? null
}

// WalletConnect provider (mobile QR) — showQrModal renders the QR sheet.
async function getWcProvider(): Promise<EIP1193Provider | null> {
  if (wcProvider) return wcProvider
  if (!wcInitPromise) {
    wcInitPromise = EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      chains: [CHAIN_ID],
      rpcMap: { [CHAIN_ID]: paymentChain.rpcUrls.default.http[0] },
      metadata: {
        name: BRAND,
        description: BRAND_DESCRIPTION,
        url: typeof window !== 'undefined' ? window.location.origin : '',
        icons: []
      }
    })
      .then((p) => {
        wcProvider = p as unknown as EIP1193Provider
        return wcProvider
      })
      .catch((e) => {
        console.error('[wallet] WalletConnect init failed (check projectId):', e)
        return null
      })
  }
  return wcInitPromise
}

// Pick the active provider: injected extension first, WalletConnect QR otherwise.
async function resolveProvider(): Promise<EIP1193Provider | null> {
  const ext = extensionProvider()
  if (ext) return ext
  return getWcProvider()
}

function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: paymentChain,
      transport: http()
    })
  }
  return publicClient
}

function makeWalletClient(provider: EIP1193Provider): WalletClient {
  return createWalletClient({
    chain: paymentChain,
    transport: custom(provider)
  })
}

export async function hasEthereum(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  // Injected extension or the WalletConnect (mobile) path
  if (extensionProvider()) return true
  return Boolean(await getWcProvider())
}

export async function connect(): Promise<Address> {
  const provider = await resolveProvider()
  if (!provider) {
    throw new Error('Could not initialise a wallet connection. Please try again in a moment.')
  }
  activeProvider = provider
  // eth_requestAccounts: extension popup / WalletConnect QR sheet
  const accounts = (await provider.request({
    method: 'eth_requestAccounts'
  })) as Address[]
  const [address] = accounts
  if (!address) {
    throw new Error('no-accounts')
  }
  return address
}

export async function getChainId(): Promise<number> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
  return Number.parseInt(chainIdHex, 16)
}

/** Switch (or add) the payment network. Re-checks the live chain before reporting success. */
export async function switchToPaymentChain(): Promise<boolean> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
  try {
    await client.switchChain({ id: CHAIN_ID })
  } catch (err) {
    const e = err as { code?: number }
    if (e && e.code === 4902) {
      try {
        await client.addChain({ chain: paymentChain })
        await client.switchChain({ id: CHAIN_ID })
      } catch {
        // The app may have added/switched already — verified below
      }
    }
  }
  // Re-read the live chain (MetaMask may still be applying the switch)
  for (let i = 0; i < 6; i++) {
    try {
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
      if (Number.parseInt(chainIdHex, 16) === CHAIN_ID) {
        return true
      }
    } catch {
      // transient — retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export async function signMessage(message: string, account: Address): Promise<string> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) {
    throw new Error('no-wallet-provider')
  }
  // 60s timeout: mobile app signing can be slow, but never hang forever.
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('The signature request timed out. Please check the MetaMask app.')), 60_000)
  )
  // viem's EIP1193Provider request union lacks personal_sign — call it loosely
  const loose = provider as unknown as {
    request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
  }
  const sig = (await Promise.race([
    loose.request({
      method: 'personal_sign',
      params: [message, account]
    }),
    timeout
  ])) as string
  return sig
}

export async function getUsdcBalance(usdcToken: string, address: Address): Promise<bigint> {
  const client = getPublicClient()
  const result = await client.readContract({
    address: usdcToken as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address]
  })
  return result as bigint
}

/** Pull a revert name out of a viem contract error so the UI can map it to a message. */
function contractErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  for (const name of ['OrderNotRegistered', 'NotOrderPayer', 'AmountMismatch', 'OrderAlreadyPaid']) {
    if (msg.includes(name)) return name
  }
  return msg
}

export async function approve(
  usdcToken: string,
  contractAddress: string,
  amountMicro: bigint,
  account: Address
): Promise<string> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
  const hash = await client.writeContract({
    chain: paymentChain,
    address: usdcToken as Address,
    abi: erc20Abi,
    functionName: 'approve',
    args: [contractAddress as Address, amountMicro],
    account
  })
  // Wait for the on-chain result — never treat a submitted tx as success
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') {
    throw new Error('The USDC approval reverted on-chain. Please try again.')
  }
  return hash
}

export async function pay(
  contractAddress: string,
  gatewayOrderId: string,
  amountMicro: bigint,
  account: Address
): Promise<string> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
  // Pre-flight simulation — catches unregistered / already-paid / amount-mismatch reverts
  // before the MetaMask popup and before any gas is spent
  try {
    await getPublicClient().simulateContract({
      chain: paymentChain,
      address: contractAddress as Address,
      abi: shopPaymentAbi,
      functionName: 'pay',
      args: [BigInt(gatewayOrderId), amountMicro],
      account
    })
  } catch (err) {
    throw new Error(contractErrorMessage(err))
  }
  const hash = await client.writeContract({
    chain: paymentChain,
    address: contractAddress as Address,
    abi: shopPaymentAbi,
    functionName: 'pay',
    args: [BigInt(gatewayOrderId), amountMicro],
    account
  })
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') {
    throw new Error('The payment reverted on-chain. Please check your order history for the status.')
  }
  return hash
}

/** Testnet only — mints test USDC so the demo flow works end to end. */
export async function faucet(
  usdcToken: string,
  address: Address,
  amountMicro: bigint
): Promise<string> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
  const hash = await client.writeContract({
    chain: paymentChain,
    address: usdcToken as Address,
    abi: erc20Abi,
    functionName: 'faucet',
    args: [address, amountMicro],
    account: address
  })
  return hash
}

export function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
