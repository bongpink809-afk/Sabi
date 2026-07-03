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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

import { config } from '../wagmi';

const client = new QueryClient();

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        <RainbowKitProvider>
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default MyApp;
