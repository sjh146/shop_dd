// viem 2.21.55 wallet helpers — 데스크톱 확장(window.ethereum) + WalletConnect QR(모바일).
// MetaMask SDK는 응답 중계 유실 문제(서명 후 웹 미반영)로 제거 — 표준 WalletConnect 경로 사용.
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

// WalletConnect Cloud 프로젝트 ID (https://cloud.walletconnect.com 에서 생성 — 공개용 클라이언트 ID)
const WALLETCONNECT_PROJECT_ID = 'PENDING_USER_PROJECT_ID'

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

let publicClient: PublicClient | null = null
let wcProvider: EIP1193Provider | null = null
let wcInitPromise: Promise<EIP1193Provider | null> | null = null
let activeProvider: EIP1193Provider | null = null

function extensionProvider(): EIP1193Provider | null {
  return (window.ethereum as EIP1193Provider | undefined) ?? null
}

// WalletConnect 프로바이더 (모바일 QR). showQrModal로 QR 모달 자동 표시.
async function getWcProvider(): Promise<EIP1193Provider | null> {
  if (wcProvider) return wcProvider
  if (!wcInitPromise) {
    wcInitPromise = EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      chains: [BASE_SEPOLIA_CHAIN_ID],
      rpcMap: { [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.base.org' },
      metadata: {
        name: '직구창고',
        description: '알리익스프레스 직배송 상품을 USDC로 결제하는 테스트넷 직구 상점',
        url: typeof window !== 'undefined' ? window.location.origin : '',
        icons: []
      }
    })
      .then((p) => {
        wcProvider = p as unknown as EIP1193Provider
        return wcProvider
      })
      .catch((e) => {
        console.error('[wallet] WalletConnect init 실패 (projectId 확인):', e)
        return null
      })
  }
  return wcInitPromise
}

// 활성 프로바이더 결정: 확장 프로그램 우선, 없으면 WalletConnect(모바일 QR).
async function resolveProvider(): Promise<EIP1193Provider | null> {
  const ext = extensionProvider()
  if (ext) return ext
  return getWcProvider()
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

function makeWalletClient(provider: EIP1193Provider): WalletClient {
  return createWalletClient({
    chain: baseSepolia,
    transport: custom(provider)
  })
}

export async function hasEthereum(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  // 확장 프로그램 또는 WalletConnect(모바일) 경로 가능 여부
  if (extensionProvider()) return true
  return Boolean(await getWcProvider())
}

export async function connect(): Promise<Address> {
  const provider = await resolveProvider()
  if (!provider) {
    throw new Error('지갑 연결을 초기화하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
  activeProvider = provider
  // eth_requestAccounts: 확장 팝업 / WalletConnect QR 모달 표시
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

export async function switchToBaseSepolia(): Promise<boolean> {
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
  try {
    await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
  } catch (err) {
    const e = err as { code?: number }
    if (e && e.code === 4902) {
      try {
        await client.addChain({ chain: baseSepolia })
        await client.switchChain({ id: BASE_SEPOLIA_CHAIN_ID })
      } catch {
        // 앱에서 이미 추가/전환됐을 수 있음 — 아래에서 실제 체인 재확인
      }
    }
  }
  // 실제 체인 재확인 (전환 반영 대기) — MetaMask가 "전환됨"을 표시하면 여기서 잡힘
  for (let i = 0; i < 6; i++) {
    try {
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
      if (Number.parseInt(chainIdHex, 16) === BASE_SEPOLIA_CHAIN_ID) {
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
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) {
    throw new Error('no-wallet-provider')
  }
  // 60초 타임아웃: 모바일 앱 서명 대기. 무한 대기 방지
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('서명 요청이 시간 초과됐어요. MetaMask 앱을 확인해 주세요.')), 60_000)
  )
  // viem의 EIP1193Provider request 유니온 타입에 personal_sign이 없어 느슨하게 호출
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
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
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
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
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
  const provider = activeProvider ?? (await resolveProvider())
  if (!provider) throw new Error('no-wallet-provider')
  const client = makeWalletClient(provider)
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
