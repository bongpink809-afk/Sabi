import { useState } from 'react'
import { useWriteContract, usePublicClient, useSwitchChain, useAccount } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import {
  ARC_DOMAIN,
  baseSepolia,
  arbitrumSepolia,
  BASE_SEPOLIA_USDC_ADDRESS,
  BASE_SEPOLIA_DOMAIN,
  ARBITRUM_SEPOLIA_USDC_ADDRESS,
  ARBITRUM_SEPOLIA_DOMAIN,
  ETHEREUM_SEPOLIA_USDC_ADDRESS,
  ETHEREUM_SEPOLIA_DOMAIN,
  BASE_TOKEN_MESSENGER_ADDRESS,
  TOKEN_MESSENGER_V2_ABI,
  ERC20_ABI,
} from '../lib/contracts'
import {
  encodeHookData,
  SABI_BILL_MINT_RECIPIENT,
  DESTINATION_CALLER_ANY,
  FAST_MIN_FINALITY,
  fastMaxFee,
} from '../lib/crosschain'

// Chain nguồn hỗ trợ burn — thêm chain mới chỉ cần thêm 1 entry vào
// SOURCE_CHAIN_CONFIG + 1 dòng usePublicClient bên dưới
export type SourceChain = 'base' | 'arbitrum' | 'ethereum'

const SOURCE_CHAIN_CONFIG = {
  base: {
    chain: baseSepolia,
    usdcAddress: BASE_SEPOLIA_USDC_ADDRESS,
    domain: BASE_SEPOLIA_DOMAIN,
  },
  arbitrum: {
    chain: arbitrumSepolia,
    usdcAddress: ARBITRUM_SEPOLIA_USDC_ADDRESS,
    domain: ARBITRUM_SEPOLIA_DOMAIN,
  },
  ethereum: {
    chain: sepolia,
    usdcAddress: ETHEREUM_SEPOLIA_USDC_ADDRESS,
    domain: ETHEREUM_SEPOLIA_DOMAIN,
  },
} as const

interface BurnParams {
  sourceChain: SourceChain // 'base' | 'arbitrum' | 'ethereum' — chọn chain nguồn để burn
  amount: bigint // 6 decimals, ví dụ 1 USDC = 1000000n
  billId: bigint
  shareId?: number // undefined = OPEN_SLOT, có giá trị = ASSIGNED
}

export function useBurnCrossChain() {
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()

  // Mỗi chain nguồn 1 publicClient, tra theo key — bỏ ternary vì 3 chain trở lên
  // ternary sẽ rối và dễ quên case khi thêm chain mới.
  // Lưu ý rules of hooks: các usePublicClient này phải gọi cố định mỗi render,
  // KHÔNG được đưa vào điều kiện if hay vòng lặp.
  const publicClients = {
    base: usePublicClient({ chainId: baseSepolia.id }),
    arbitrum: usePublicClient({ chainId: arbitrumSepolia.id }),
    ethereum: usePublicClient({ chainId: sepolia.id }),
  }

  const [isBurning, setIsBurning] = useState(false)

  const burn = async ({ sourceChain, amount, billId, shareId }: BurnParams): Promise<`0x${string}`> => {
    setIsBurning(true)
    try {
      const config = SOURCE_CHAIN_CONFIG[sourceChain]
      const publicClient = publicClients[sourceChain]

      // Chủ động switch network trước khi ký — không phụ thuộc user tự đổi tay
      // hoặc chờ ví tự động switch (không đáng tin cậy, đã gặp lỗi khi thiếu bước này)
      if (currentChainId !== config.chain.id) {
        await switchChainAsync({ chainId: config.chain.id })
      }

      // Lấy gas fee hiện tại + thêm buffer 50% — tránh lỗi "max fee less than base fee"
      // do base fee biến động nhanh giữa lúc ước tính và lúc ký.
      // Riêng Ethereum Sepolia gas biến động mạnh hơn L2 — buffer 50% vẫn đủ,
      // nhưng nếu gặp lỗi này trên Eth Sepolia thì tăng lên 200n/100n.
      const feeData = await publicClient!.estimateFeesPerGas()
      const gasOverrides = {
        maxFeePerGas: (feeData.maxFeePerGas * 150n) / 100n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 150n) / 100n,
      }

      // Bước 1: approve TokenMessengerV2 dùng USDC trên chain nguồn đã chọn
      // BASE_TOKEN_MESSENGER_ADDRESS dùng chung cho mọi chain — Circle deploy
      // qua CREATE2 nên TokenMessengerV2 cùng địa chỉ trên mọi EVM testnet
      const approveTx = await writeContractAsync({
        chainId: config.chain.id,
        address: config.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BASE_TOKEN_MESSENGER_ADDRESS, amount],
        ...gasOverrides,
      })
      await publicClient!.waitForTransactionReceipt({ hash: approveTx })

      // Bước 2: depositForBurnWithHook — mintRecipient trỏ thẳng vào SabiBill,
      // hookData mang billId (+ shareId nếu ASSIGNED) để payCrossChain tự decode sau này
      const burnTx = await writeContractAsync({
        chainId: config.chain.id,
        address: BASE_TOKEN_MESSENGER_ADDRESS,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: 'depositForBurnWithHook',
        args: [
          amount,
          ARC_DOMAIN,
          SABI_BILL_MINT_RECIPIENT,
          config.usdcAddress,
          DESTINATION_CALLER_ANY,
          fastMaxFee(amount),
          FAST_MIN_FINALITY,
          encodeHookData(billId, shareId),
        ],
        ...gasOverrides,
      })
      await publicClient!.waitForTransactionReceipt({ hash: burnTx })

      return burnTx
    } finally {
      setIsBurning(false)
    }
  }

  return { burn, isBurning }
}