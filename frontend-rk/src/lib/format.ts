// Rút gọn hash/địa chỉ dạng 0x — front ký tự đầu + … + back ký tự cuối
export function truncateHash(hash: string, front = 6, back = 4): string {
  if (hash.length <= front + back + 1) return hash
  return `${hash.slice(0, front)}…${hash.slice(-back)}`
}
