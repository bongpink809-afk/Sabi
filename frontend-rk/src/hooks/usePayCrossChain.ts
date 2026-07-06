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
      // (writeContractAsync với chainId khác chain hiện tại sẽ throw ChainMismatchError, không tự switch)
      const chainBefore = currentChainId
      if (chainBefore !== arcTestnet.id) {
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
        throw new Error(`payCrossChain reverted: ${receipt.transactionHash}`)
        }

        // Trả ví về chain user đang đứng trước khi relay — chỉ mượn Arc để ký payCrossChain,
        // không được để ví "kẹt" lại Arc khi user không chủ động switch.
        // Best-effort: switch về thất bại không được ảnh hưởng kết quả thanh toán đã xong.
        if (chainBefore !== undefined && chainBefore !== arcTestnet.id) {
          try {
            await switchChainAsync({ chainId: chainBefore })
          } catch {
            // bỏ qua — user tự đổi tay được, tiền đã ghi nhận xong trên Arc
          }
        }

        // PHẢI trả hash từ receipt, KHÔNG trả `tx`: nếu tx bị replace (speed-up,
        // hoặc 2 tx cùng nonce đè nhau), viem vẫn resolve với receipt của tx THAY THẾ —
        // lúc đó `tx` gốc không tồn tại trên chain, hiển thị ra sẽ là hash chết
        return receipt.transactionHash
    } finally {
      setIsRelaying(false)
    }
  }

  return { relay, isRelaying }
}