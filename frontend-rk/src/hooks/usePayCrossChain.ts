import { useState } from 'react'
import { useWriteContract, usePublicClient, useSwitchChain, useAccount } from 'wagmi'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI } from '../lib/contracts'
import { arcTestnet } from '../wagmi'

export function usePayCrossChain() {
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const [isRelaying, setIsRelaying] = useState(false)

  // Gọi payCrossChain trên Arc — hàm này tự gọi receiveMessage() bên trong
  // rồi tự decode hookData để biết trả cho bill/share nào, ghi nhận "đã trả" luôn 1 lần
  const relay = async (message: `0x${string}`, attestation: `0x${string}`): Promise<`0x${string}`> => {
    setIsRelaying(true)
    try {
      // Sau bước burn, ví đang ở Base Sepolia — bắt buộc chuyển sang Arc trước khi gọi payCrossChain
      if (currentChainId !== arcTestnet.id) {
        await switchChainAsync({ chainId: arcTestnet.id })
      }

      const tx = await writeContractAsync({
        chainId: arcTestnet.id,
        address: SABI_BILL_ADDRESS,
        abi: SABI_BILL_ABI,
        functionName: 'payCrossChain',
        args: [message, attestation],
        })
        const receipt = await publicClient!.waitForTransactionReceipt({ hash: tx })

        if (receipt.status === 'reverted') {
        throw new Error(`payCrossChain reverted: ${tx}`)
        }

        return tx
    } finally {
      setIsRelaying(false)
    }
  }

  return { relay, isRelaying }
}