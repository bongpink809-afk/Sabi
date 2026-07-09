// Sửa lỗi Next.js dev overlay crash khi log object có chứa BigInt (ví dụ lỗi ví MetaMask)
// JSON.stringify mặc định không biết xử lý BigInt — dạy nó tự chuyển thành string
if (typeof (BigInt.prototype as any).toJSON === 'undefined') {
  ;(BigInt.prototype as any).toJSON = function (this: bigint) {
    return this.toString()
  }
}
import '../styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';

import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, useAccount, useSwitchChain } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { appWithTranslation } from 'next-i18next';

import { config, arcTestnet } from '../wagmi';

// QueryClient với defaultOptions đã tắt refetchOnWindowFocus và gcTime ngắn —
// ngăn wagmi/react-query tự refetch định kỳ gây layout jump trên mobile mỗi ~1 phút.
// staleTime: 20s — data cũ sau 20s mới tự fetch lại khi cần,
// không fetch liên tục khi user ẩn/hiện tab hay switch app trên điện thoại.
const client = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 20_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
})

// Tự chuyển sang Arc Testnet ngay khi vừa kết nối ví — chỉ bắn 1 lần đúng lúc
// chuyển từ "chưa kết nối" sang "đã kết nối" (theo dõi bằng ref `wasConnected`),
// KHÔNG chạy lại mỗi khi chainId đổi giữa phiên. Nếu bắn lại liên tục sẽ đánh
// nhau với các chỗ chủ động switch sang chain khác giữa phiên (vd trả cross-chain
// cần switch sang Base/Arbitrum để ký rồi switch về) — chain đó sẽ bị kéo về
// Arc ngay lập tức, phá luồng ký giao dịch.
function AutoSwitchToArc() {
  const { isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wasConnected = useRef(false)

  useEffect(() => {
    if (isConnected && !wasConnected.current && chainId !== arcTestnet.id) {
      switchChain({ chainId: arcTestnet.id })
    }
    wasConnected.current = isConnected
  }, [isConnected, chainId, switchChain])

  return null
}

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        <RainbowKitProvider>
          <AutoSwitchToArc />
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default appWithTranslation(MyApp);
