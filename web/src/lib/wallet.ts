// viem 2.21.55 wallet helpers — MetaMask SDK (데스크톱 확장 + 모바일 QR) + Base Sepolia USDC flow.
import MetaMaskSDK from '@metamask/sdk'
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
let sdkInstance: MetaMaskSDK | null = null

// MetaMask SDK (EIP-1193 프로바이더 + QR 모달).
// 데스크톱: 확장 프로그램 자동 감지 → 확장 주입. 모바일: QR 모달 → MetaMask 앱 deeplink.
// (모바일 MetaMask는 window.ethereum을 주입할 수 없으므로 SDK가 QR로 연결해줌)
function getSdkInstance(): MetaMaskSDK | null {
  if (typeof window === 'undefined') return null
  if (!sdkInstance) {
    try {
      sdkInstance = new MetaMaskSDK({
        dappMetadata: { name: '직구창고', url: window.location.origin },
        injectProvider: true,
        checkInstallationImmediately: false,
        checkInstallationOnAllCalls: false,
        logging: { developerMode: false }
      })
    } catch {
      sdkInstance = null
    }
  }
  return sdkInstance
}

function getWalletProvider(): Parameters<typeof custom>[0] | undefined {
  const sdk = getSdkInstance()
  const provider = (sdk?.getProvider() as Parameters<typeof custom>[0] | undefined) ?? window.ethereum
  return provider as Parameters<typeof custom>[0] | undefined
}

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
    const provider = getWalletProvider()
    if (!provider) {
      throw new Error('no-wallet-provider')
    }
    walletClient = createWalletClient({
      chain: baseSepolia,
      transport: custom(provider)
    })
  }
  return walletClient
}

export function hasEthereum(): boolean {
  if (typeof window === 'undefined') return false
  // SDK가 있으면 확장 프로그램 없이도 모바일 QR 연결 가능
  return Boolean(getSdkInstance() || window.ethereum)
}

export async function connect(): Promise<Address> {
  const sdk = getSdkInstance()
  if (sdk) {
    try {
      if (!sdk.isInitialized()) {
        await sdk.init()
      }
      // SDK connect: 데스크톱 확장 팝업 / 모바일 QR 모달 자동 처리
      const accounts = await sdk.connect()
      const [address] = (accounts as Address[]) ?? []
      if (!address) {
        throw new Error('no-accounts')
      }
      return address
    } catch (e) {
      // SDK 연결 실패 시 확장 프로그램 폴백
      if (!window.ethereum) {
        throw e
      }
    }
  }
  // 폴백: window.ethereum (확장 프로그램) — eth_requestAccounts로 실제 프롬프트
  const client = createWalletClient({
    chain: baseSepolia,
    transport: custom(window.ethereum as Parameters<typeof custom>[0])
  })
  const accounts = (await client.request({ method: 'eth_requestAccounts' })) as Address[]
  const [address] = accounts
  if (!address) {
    throw new Error('no-accounts')
  }
  return address
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
