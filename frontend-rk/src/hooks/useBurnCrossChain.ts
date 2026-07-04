import { useState } from 'react'
import { useWriteContract, usePublicClient, useSwitchChain, useAccount } from 'wagmi'
import {
  ARC_DOMAIN,
  baseSepolia,
  arbitrumSepolia,
  BASE_SEPOLIA_USDC_ADDRESS,
  BASE_SEPOLIA_DOMAIN,
  ARBITRUM_SEPOLIA_USDC_ADDRESS,
  ARBITRUM_SEPOLIA_DOMAIN,
  BASE_TOKEN_MESSENGER_ADDRESS,
  TOKEN_MESSENGER_V2_ABI,
  ERC20_ABI,
} from '../lib/contracts'
import {
  encodeHookData,
  SABI_BILL_MINT_RECIPIENT,
  DESTINATION_CALLER_ANY,
  STANDARD_MIN_FINALITY,
  STANDARD_MAX_FEE,
} from '../lib/crosschain'

// Chain nguồn hỗ trợ burn — thêm chain mới chỉ cần thêm 1 dòng vào đây
export type SourceChain = 'base' | 'arbitrum'

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
} as const

interface BurnParams {
  sourceChain: SourceChain // 'base' hoặc 'arbitrum' — chọn chain nguồn để burn
  amount: bigint // 6 decimals, ví dụ 1 USDC = 1000000n
  billId: bigint
  shareId?: number // undefined = OPEN_SLOT, có giá trị = ASSIGNED
}

export function useBurnCrossChain() {
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()
  // publicClient không cố định chain nữa — sẽ lấy đúng theo sourceChain lúc gọi burn()
  const publicClientBase = usePublicClient({ chainId: baseSepolia.id })
  const publicClientArbitrum = usePublicClient({ chainId: arbitrumSepolia.id })
  const [isBurning, setIsBurning] = useState(false)

  const burn = async ({ sourceChain, amount, billId, shareId }: BurnParams): Promise<`0x${string}`> => {
    setIsBurning(true)
    try {
      const config = SOURCE_CHAIN_CONFIG[sourceChain]
      const publicClient = sourceChain === 'base' ? publicClientBase : publicClientArbitrum

      // Chủ động switch network trước khi ký — không phụ thuộc user tự đổi tay
      // hoặc chờ ví tự động switch (không đáng tin cậy, đã gặp lỗi khi thiếu bước này)
      if (currentChainId !== config.chain.id) {
        await switchChainAsync({ chainId: config.chain.id })
      }

      // Lấy gas fee hiện tại + thêm buffer 50% — tránh lỗi "max fee less than base fee"
      // do base fee trên Arbitrum/Base Sepolia biến động nhanh giữa lúc ước tính và lúc ký
      const feeData = await publicClient!.estimateFeesPerGas()
      const gasOverrides = {
        maxFeePerGas: (feeData.maxFeePerGas * 150n) / 100n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 150n) / 100n,
      }

      // Bước 1: approve TokenMessengerV2 dùng USDC trên chain nguồn đã chọn
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
          STANDARD_MAX_FEE,
          STANDARD_MIN_FINALITY,
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