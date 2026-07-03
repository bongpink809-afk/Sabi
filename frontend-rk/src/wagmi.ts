import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base, baseSepolia, arbitrum, optimism } from 'wagmi/chains'
import { defineChain } from 'viem'

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
  testnet: true,
})

export const config = getDefaultConfig({
  appName: 'Sabi',
  projectId: '0599aca09205f1c97acf0fb11b2cc645',
  chains: [arcTestnet, baseSepolia, base, mainnet, arbitrum, optimism],
  ssr: true,
})