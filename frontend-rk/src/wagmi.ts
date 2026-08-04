import { baseSepolia, arbitrumSepolia, sepolia } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { http } from 'viem'
import { withGlobalConcurrency } from './lib/concurrency'

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

// fetch riêng cho Arc Testnet — mọi request VẬT LÝ tới RPC này (kể cả từ
// useReadContract/useReadContracts của wagmi, không chỉ scanEventLogs) đều
// xếp hàng qua đúng 1 rate-limiter đã verify an toàn (2 request/400ms, xem
// concurrency.ts). Trước đây chỉ scanEventLogs tự bọc withGlobalConcurrency ở
// từng lệnh gọi — các hook đọc contract state qua Multicall3 (getBill,
// shareCount, getShare, allowance...) chạy hoàn toàn tự do song song, cộng dồn
// với phần quét log khiến tổng số request đồng thời vượt xa mức RPC public
// chịu được. Đặt ở tầng transport là nơi DUY NHẤT chắc chắn bắt được MỌI
// nguồn gọi RPC, không phụ thuộc việc từng chỗ gọi có nhớ tự bọc hay không.
const arcThrottledFetch: typeof fetch = (input, init) => withGlobalConcurrency(() => fetch(input, init))

export const config = getDefaultConfig({
  appName: 'Sabi',
  projectId: '0599aca09205f1c97acf0fb11b2cc645',
  chains: [arcTestnet, baseSepolia, arbitrumSepolia, sepolia],
  transports: {
    [arcTestnet.id]: http(undefined, { fetchFn: arcThrottledFetch }),
    [baseSepolia.id]: http('https://base-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
    [arbitrumSepolia.id]: http('https://arb-sepolia.g.alchemy.com/v2/gDAnPNo16g_MPXWCSBYGQ'),
    [sepolia.id]: http('https://eth-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
  },
  ssr: true,
})