import { baseSepolia, arbitrumSepolia, sepolia } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { http } from 'viem'

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arc Scan', url: 'https://testnet.arcscan.app' },
  },
  contracts: {
    // Multicall3 — địa chỉ deterministic (CREATE2) giống nhau trên mọi EVM chain,
    // đã verify có thật trên Arc Testnet qua eth_getCode. Thiếu khai báo này khiến
    // useReadContracts KHÔNG gộp được thành 1 lệnh multicall, phải rơi về gọi rời
    // từng contract read (N request riêng, không qua rate-limiter của app) — đây
    // là nguyên nhân thật của việc 1 vài share bị rớt ngẫu nhiên trong danh sách.
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
  testnet: true,
})

export const config = getDefaultConfig({
  appName: 'Sabi',
  projectId: '0599aca09205f1c97acf0fb11b2cc645',
  chains: [arcTestnet, baseSepolia, arbitrumSepolia, sepolia],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http('https://base-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
    [arbitrumSepolia.id]: http('https://arb-sepolia.g.alchemy.com/v2/gDAnPNo16g_MPXWCSBYGQ'),
    [sepolia.id]: http('https://eth-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
  },
  ssr: true,
})