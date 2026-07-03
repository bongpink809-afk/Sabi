import { encodeAbiParameters, pad, parseAbiParameters } from 'viem'
import { SABI_BILL_ADDRESS } from './contracts'

// hookData: OPEN_SLOT chỉ có billId, ASSIGNED có thêm shareId
// Format phải khớp CHÍNH XÁC với decode trong SabiBill.payCrossChain (Solidity)
export function encodeHookData(billId: bigint, shareId?: number): `0x${string}` {
  if (shareId !== undefined) {
    return encodeAbiParameters(parseAbiParameters('uint256, uint256'), [billId, BigInt(shareId)])
  }
  return encodeAbiParameters(parseAbiParameters('uint256'), [billId])
}

// mintRecipient của CCTP là bytes32 — pad địa chỉ 20 byte của SabiBill về 32 byte
// Đây chính là chỗ burn.sh làm SAI (pad HOOK_RECEIVER thay vì SabiBill)
export const SABI_BILL_MINT_RECIPIENT = pad(SABI_BILL_ADDRESS, { size: 32 })

// destinationCaller = 0x0 → ai relay cũng được, không giới hạn người gọi payCrossChain
export const DESTINATION_CALLER_ANY = pad('0x00', { size: 32 })

// Standard transfer (không phải fast) — PHẢI đi cùng nhau, sai 1 trong 2 sẽ bị tính phí hoặc lỗi
export const STANDARD_MIN_FINALITY = 2000
export const STANDARD_MAX_FEE = 0n