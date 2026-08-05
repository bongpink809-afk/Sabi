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
    // Gọi qua /api/rpc-arc (proxy server, xem pages/api/rpc-arc.ts) thay vì
    // thẳng rpc.testnet.arc.network — RPC này không trả header CORS ở bước
    // preflight nên trình duyệt luôn bị chặn (đã verify bằng Network tab thật:
    // "blocked by CORS policy"), không phải lỗi thoáng qua nên retry phía
    // client không cứu được. Rate-limit + retry-cap cho lượt gọi thật ra
    // ngoài RPC giờ nằm trong chính route đó (server-side, không còn ở tầng
    // transport client này nữa — xem comment trong rpc-arc.ts lý do).
    //
    // timeout: 30_000 — viem mặc định chỉ chờ 10s/request (xem
    // utils/rpc/http.ts). Circuit breaker trong rpc-arc.ts có thể tự retry
    // tối đa 5 lần, backoff cộng dồn ~22s khi RPC thật quá tải — nếu client
    // bỏ cuộc sau 10s trong lúc proxy vẫn đang retry (chưa kịp trả lời),
    // viem throw TimeoutError, và waitForTransactionReceipt coi lỗi này khác
    // "chưa tìm thấy tx" nên reject NGAY, dừng poll hẳn dù tx đã confirm thật
    // trên chain — đúng nguyên nhân nút Approve/Pay kẹt "Processing" vĩnh
    // viễn. Timeout ở đây phải lớn hơn worst-case của chính proxy.
    [arcTestnet.id]: http('/api/rpc-arc', { timeout: 30_000 }),
    [baseSepolia.id]: http('https://base-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
    [arbitrumSepolia.id]: http('https://arb-sepolia.g.alchemy.com/v2/gDAnPNo16g_MPXWCSBYGQ'),
    [sepolia.id]: http('https://eth-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
  },
  ssr: true,
})