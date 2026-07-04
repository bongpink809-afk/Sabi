import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base, baseSepolia, arbitrumSepolia, arbitrum, optimism } from 'wagmi/chains'
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
  testnet: true,
})

export const config = getDefaultConfig({
  appName: 'Sabi',
  projectId: '0599aca09205f1c97acf0fb11b2cc645',
  chains: [arcTestnet, baseSepolia, arbitrumSepolia, base, mainnet, arbitrum, optimism],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http('https://base-sepolia.g.alchemy.com/v2/ZTszNH9ETuYNUXzah7wfX'),
    [arbitrumSepolia.id]: http('https://arb-sepolia.g.alchemy.com/v2/gDAnPNo16g_MPXWCSBYGQ'),
    [base.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
  },
  ssr: true,
})