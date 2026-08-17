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

export async function switchToBaseSepolia(): Promise<boolean> {
  const client = getWalletClient()
  try {
    await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
  } catch (err) {
    const e = err as { code?: number }
    if (e && e.code === 4902) {
      try {
        await client.addChain({ chain: baseSepolia })
        await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
      } catch {
        // 모바일 앱에서 이미 추가/전환됐을 수 있음 — 실패로 취급하지 않고 아래에서 재확인
      }
    }
    // switchChain 응답이 SDK 경유로 유실돼도 실제 전환은 됐을 수 있음
  }
  // 실제 체인 재확인 (SDK 경유 전환 반영 대기) — MetaMask가 "전환됨"을 표시하면 여기서 잡힘
  for (let i = 0; i < 6; i++) {
    try {
      if ((await client.getChainId()) === BASE_SEPOLIA_CHAIN_ID) {
        return true
      }
    } catch {
      // 일시적 오류 — 재시도
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export async function signMessage(message: string, account: Address): Promise<string> {
  const sdk = getSdkInstance()
  // 1) SDK 네이티브 로그인 흐름 (connectAndSign) — 모바일 중계에 최적화된 서명 경로
  if (sdk) {
    try {
      if (!sdk.isInitialized()) {
        await sdk.init()
      }
      const res = await sdk.connectAndSign({ msg: message })
      if (Array.isArray(res)) {
        // [address, signature] 형태
        const sig = res[1] as string | undefined
        if (typeof sig === 'string' && sig.startsWith('0x')) {
          console.log('[wallet] signMessage via connectAndSign')
          return sig
        }
      } else if (typeof res === 'string' && res.startsWith('0x')) {
        console.log('[wallet] signMessage via connectAndSign (single)')
        return res
      }
    } catch {
      // fall through — provider 직접 요청으로
    }
  }

  // 2) provider 직접 personal_sign (헥스 인코딩 — SDK 중계가 평문 메시지를 유실하는 케이스 대응)
  const provider = getWalletProvider()
  if (!provider) {
    throw new Error('no-wallet-provider')
  }
  const hexMessage =
    '0x' +
    Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  // 60초 타임아웃: 모바일 앱 서명 대기. 무한 대기 방지
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('서명 요청이 시간 초과됐어요. MetaMask 앱을 확인해 주세요.')), 60_000)
  )
  const sig = (await Promise.race([
    provider.request({
      method: 'personal_sign',
      params: [hexMessage, account]
    }),
    timeout
  ])) as string
  return sig
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
