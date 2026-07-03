import { ARC_DOMAIN } from '../lib/contracts' 
import { useState } from 'react'
import { useWriteContract, usePublicClient, useSwitchChain, useAccount } from 'wagmi'
import { baseSepolia } from '../lib/contracts'
import {
  BASE_SEPOLIA_USDC_ADDRESS,
  BASE_TOKEN_MESSENGER_ADDRESS,
  BASE_SEPOLIA_DOMAIN,
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

interface BurnParams {
  amount: bigint // 6 decimals, ví dụ 1 USDC = 1000000n
  billId: bigint
  shareId?: number // undefined = OPEN_SLOT, có giá trị = ASSIGNED
}

export function useBurnCrossChain() {
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()
  const publicClient = usePublicClient({ chainId: baseSepolia.id })
  const [isBurning, setIsBurning] = useState(false)

  const burn = async ({ amount, billId, shareId }: BurnParams): Promise<`0x${string}`> => {
    setIsBurning(true)
    try {
         // Chủ động switch network trước khi ký — không phụ thuộc user tự đổi tay
      // hoặc chờ ví tự động switch (không đáng tin cậy, vừa gặp lỗi ở đây)
      if (currentChainId !== baseSepolia.id) {
        await switchChainAsync({ chainId: baseSepolia.id })
      }
      // Bước 1: approve TokenMessengerV2 dùng USDC trên Base Sepolia
      const approveTx = await writeContractAsync({
        chainId: baseSepolia.id,
        address: BASE_SEPOLIA_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BASE_TOKEN_MESSENGER_ADDRESS, amount],
      })
      await publicClient!.waitForTransactionReceipt({ hash: approveTx })

      // Bước 2: depositForBurnWithHook — mintRecipient trỏ thẳng vào SabiBill,
      // hookData mang billId (+ shareId nếu ASSIGNED) để payCrossChain tự decode sau này
      const burnTx = await writeContractAsync({
        chainId: baseSepolia.id,
        address: BASE_TOKEN_MESSENGER_ADDRESS,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: 'depositForBurnWithHook',
        args: [
          amount,
          ARC_DOMAIN,
          SABI_BILL_MINT_RECIPIENT,
          BASE_SEPOLIA_USDC_ADDRESS,
          DESTINATION_CALLER_ANY,
          STANDARD_MAX_FEE,
          STANDARD_MIN_FINALITY,
          encodeHookData(billId, shareId),
        ],
      })
      await publicClient!.waitForTransactionReceipt({ hash: burnTx })

      return burnTx
    } finally {
      setIsBurning(false)
    }
  }

  return { burn, isBurning }
}