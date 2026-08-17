// viem 2.21.55 wallet helpers — MetaMask + Base Sepolia USDC flow.
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Address,
  type Chain,
  type WalletClient,
  type PublicClient
} from 'viem'

declare global {
  interface Window {
    ethereum?: unknown
  }
}

export const BASE_SEPOLIA_CHAIN_ID = 84532

export const baseSepolia: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] }
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' }
  }
}

// Minimal ABIs (only the functions we call).
const mockUsdcAbi = [
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
  }
] as const

let walletClient: WalletClient | null = null
let publicClient: PublicClient | null = null

function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http()
    })
  }
  return publicClient
}

function getWalletClient(): WalletClient {
  if (!walletClient) {
    walletClient = createWalletClient({
      chain: baseSepolia,
      transport: custom(window.ethereum as Parameters<typeof custom>[0])
    })
  }
  return walletClient
}

export function hasEthereum(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum)
}

export async function getChainId(): Promise<number> {
  const client = getWalletClient()
  return client.getChainId()
}

export async function switchToBaseSepolia(): Promise<void> {
  const client = getWalletClient()
  try {
    await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
  } catch (err) {
    // If the chain is not added to the wallet, add it.
    const e = err as { code?: number }
    if (e && e.code === 4902) {
      await client.addChain({ chain: baseSepolia })
      await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
    } else {
      throw err
    }
  }
}

export async function connect(): Promise<Address> {
  const client = getWalletClient()
  const [address] = await client.getAddresses()
  if (!address) {
    throw new Error('no-accounts')
  }
  return address
}

export async function signMessage(message: string, account: Address): Promise<string> {
  const client = getWalletClient()
  return client.signMessage({ account, message })
}

export async function getUsdcBalance(
  usdcToken: string,
  address: Address
): Promise<bigint> {
  const client = getPublicClient()
  const result = await client.readContract({
    address: usdcToken as Address,
    abi: mockUsdcAbi,
    functionName: 'balanceOf',
    args: [address]
  })
  return result as bigint
}

export async function approve(
  usdcToken: string,
  contractAddress: string,
  amountMicro: bigint,
  account: Address
): Promise<string> {
  const client = getWalletClient()
  const hash = await client.writeContract({
    chain: baseSepolia,
    address: usdcToken as Address,
    abi: mockUsdcAbi,
    functionName: 'approve',
    args: [contractAddress as Address, amountMicro],
    account
  })
  return hash
}

export async function pay(
  contractAddress: string,
  gatewayOrderId: string,
  amountMicro: bigint,
  account: Address
): Promise<string> {
  const client = getWalletClient()
  const hash = await client.writeContract({
    chain: baseSepolia,
    address: contractAddress as Address,
    abi: shopPaymentAbi,
    functionName: 'pay',
    args: [BigInt(gatewayOrderId), amountMicro],
    account
  })
  return hash
}

export async function faucet(
  usdcToken: string,
  address: Address,
  amountMicro: bigint
): Promise<string> {
  const client = getWalletClient()
  const hash = await client.writeContract({
    chain: baseSepolia,
    address: usdcToken as Address,
    abi: mockUsdcAbi,
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
