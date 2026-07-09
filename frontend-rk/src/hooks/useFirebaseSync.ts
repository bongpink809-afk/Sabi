// src/hooks/useFirebaseSync.ts
// ─── Hook tổng hợp Firebase realtime sync ──────────────────────────────────
// Dùng trong các page component để:
//   1. Lắng nghe (onSnapshot) dữ liệu bill từ Firestore → cập nhật state UI
//   2. Ghi dữ liệu lên Firestore + localStorage cùng lúc khi user thay đổi
//
// Không cần auth — địa chỉ ví là định danh duy nhất.
// Firebase chỉ được dùng khi NEXT_PUBLIC_FIREBASE_PROJECT_ID đã cấu hình,
// nếu chưa config thì app vẫn hoạt động với localStorage như cũ (graceful fallback).

import { useEffect, useRef } from 'react'
import {
  listenToBill,
  listenToUserProfile,
  updateBillData,
  updateUserProfile,
  uploadAvatar,
  fetchBillTitles,
  fetchUserProfiles,
  BillFirestoreData,
  UserFirestoreData,
} from '../lib/firebase'

// ─── Hook: đồng bộ dữ liệu 1 bill cụ thể ─────────────────────────────────

/**
 * Lắng nghe Firestore realtime cho bill. Khi thiết bị khác ghi tên bill /
 * tên share lên Firestore, hook này tự cập nhật localStorage + gọi callback
 * → UI render lại ngay mà không cần reload.
 *
 * @param billId    ID của bill đang xem (string)
 * @param onUpdate  Callback nhận data mới — dùng để set state trong component
 *
 * @example
 * useBillSync(billId, (data) => {
 *   if (data.title) setBillTitle(data.title)
 *   if (data.shareNames) setShareNames(
 *     Object.fromEntries(Object.entries(data.shareNames).map(([k, v]) => [Number(k), v]))
 *   )
 * })
 */
export function useBillSync(
  billId: string | undefined,
  onUpdate: (data: BillFirestoreData) => void
) {
  // Dùng ref để callback không gây re-subscribe khi re-render
  const callbackRef = useRef(onUpdate)
  callbackRef.current = onUpdate

  useEffect(() => {
    if (!billId) return

    const unsub = listenToBill(billId, (data) => {
      // Cập nhật localStorage để offline vẫn dùng được
      if (data.title) {
        localStorage.setItem(`sabi-bill-${billId}-title`, data.title)
      }
      if (data.shareNames) {
        localStorage.setItem(`sabi-bill-${billId}-names`, JSON.stringify(
          // Firestore lưu key string ("0", "1"), localStorage dùng number key — giữ nguyên format
          Object.fromEntries(Object.entries(data.shareNames).map(([k, v]) => [Number(k), v]))
        ))
      }
      if (data.slotNames) {
        localStorage.setItem(`sabi-bill-${billId}-slotnames`, JSON.stringify(data.slotNames))
      }
      // Thông báo cho component
      callbackRef.current(data)
    })

    return () => unsub()
  }, [billId])
}

// ─── Hook: đồng bộ hồ sơ user ────────────────────────────────────────────

/**
 * Lắng nghe Firestore realtime cho profile của wallet đang kết nối.
 * Khi đổi tên trên PC → Phone tự cập nhật ngay.
 *
 * @param walletAddress  Địa chỉ ví đang connect (undefined khi chưa connect)
 * @param onUpdate       Callback nhận data mới
 *
 * @example
 * useUserProfileSync(address, (data) => {
 *   if (data.profileName) setProfileName(data.profileName)
 * })
 */
export function useUserProfileSync(
  walletAddress: string | undefined,
  onUpdate: (data: UserFirestoreData) => void
) {
  const callbackRef = useRef(onUpdate)
  callbackRef.current = onUpdate

  useEffect(() => {
    if (!walletAddress) return
    const key = walletAddress.toLowerCase()

    const unsub = listenToUserProfile(key, (data) => {
      // Ghi localStorage cho cả hai trường nếu có
      if (data.profileName) {
        localStorage.setItem(`sabi-profile-name-${key}`, data.profileName)
      }
      if (data.avatarUrl) {
        // avatarUrl — lưu vào localStorage để dùng offline
        localStorage.setItem(`sabi-profile-avatar-url-${key}`, data.avatarUrl)
      }
      // Gọi callback — dùng callbackRef để luôn có phiên bản mới nhất, không stale
      callbackRef.current(data)
    })

    return () => unsub()
  }, [walletAddress])
}

/**
 * Hook: batch-fetch và lưu title của nhiều bill khi trang Profile load —
 * trả về map billId → title để component hiển thị đúng tên thay vì "Bill #n".
 * Dùng `enabled` để chạy sau khi có danh sách billId từ on-chain.
 *
 * @example
 * const [billTitles, setBillTitles] = useState<Record<string, string>>({})
 * useBillTitlesSync(billIds, setBillTitles)
 */
export function useBillTitlesSync(
  billIds: string[],
  onFetched: (titles: Record<string, string>) => void
) {
  const callbackRef = useRef(onFetched)
  callbackRef.current = onFetched

  // Stringify làm dependency — chạy lại khi danh sách bill thay đổi
  const billIdsKey = billIds.join(',')

  useEffect(() => {
    if (!billIds.length) return
    fetchBillTitles(billIds).then((titles) => {
      if (Object.keys(titles).length > 0) {
        callbackRef.current(titles)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billIdsKey])
}

/**
 * Batch-fetch hồ sơ (profileName, avatarUrl) của nhiều địa chỉ ví — dùng để
 * hiện avatar/tên thật của người trả trong hoá đơn/danh sách phần trả, thay
 * vì tên gõ tay hoặc avatar chỉ lưu local theo từng máy.
 *
 * @example
 * useProfilesSync(payerAddresses, (profiles) => {
 *   setProfiles((prev) => ({ ...prev, ...profiles }))
 * })
 */
export function useProfilesSync(
  addresses: string[],
  onFetched: (profiles: Record<string, UserFirestoreData>) => void
) {
  const callbackRef = useRef(onFetched)
  callbackRef.current = onFetched

  // Stringify làm dependency — chỉ chạy lại khi danh sách địa chỉ thật sự đổi
  const addressesKey = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).sort().join(',')

  useEffect(() => {
    if (!addresses.length) return
    fetchUserProfiles(addresses).then((profiles) => {
      if (Object.keys(profiles).length > 0) {
        callbackRef.current(profiles)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesKey])
}

// ─── Helpers: ghi dữ liệu lên cả localStorage lẫn Firestore ────────────────────────

/**
 * Lưu tên bill: localStorage (ngay lập tức) + Firestore (background).
 */
export async function saveBillTitle(billId: string, title: string): Promise<void> {
  localStorage.setItem(`sabi-bill-${billId}-title`, title)
  await updateBillData(billId, { title })
}

/**
 * Lưu tên các share (ASSIGNED mode): localStorage + Firestore.
 * namesMap: { 0: "Lan Kim", 1: "Bảo" }
 */
export async function saveBillShareNames(
  billId: string,
  namesMap: Record<number, string>
): Promise<void> {
  localStorage.setItem(`sabi-bill-${billId}-names`, JSON.stringify(namesMap))
  // Firestore key phải là string
  await updateBillData(billId, {
    shareNames: Object.fromEntries(
      Object.entries(namesMap).map(([k, v]) => [k.toString(), v])
    ),
  })
}

/**
 * Lưu tên 1 share cụ thể (merge vào object shareNames).
 */
export async function saveSingleShareName(
  billId: string,
  shareId: number,
  name: string,
  currentNamesMap: Record<number, string>
): Promise<void> {
  const next = { ...currentNamesMap, [shareId]: name }
  await saveBillShareNames(billId, next)
}

/**
 * Upload avatar lên Firebase Storage + lưu URL vào Firestore.
 * Cần bật Firebase Storage trong Firebase Console trước khi dùng.
 */
export async function saveAvatar(walletAddress: string, base64DataUrl: string): Promise<void> {
  const key = walletAddress.toLowerCase()
  // localStorage (hiển ngay trước khi upload xong)
  localStorage.setItem(`sabi-profile-avatar-${key}`, base64DataUrl)
  // Upload lên Firebase Storage → lưu URL vào Firestore
  const url = await uploadAvatar(key, base64DataUrl)
  if (url) {
    // Storage ghi đè cùng 1 path (avatars/{address}) nên download URL giữ
    // nguyên token y hệt lần trước — gắn thêm ?v=timestamp để URL thực sự đổi,
    // ép trình duyệt tải lại ảnh mới thay vì dùng cache của ảnh cũ (thiết bị
    // khác nhận URL giống hệt qua onSnapshot nên <img src> không đổi giá trị).
    const versionedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
    localStorage.setItem(`sabi-profile-avatar-url-${key}`, versionedUrl)
    await updateUserProfile(key, { avatarUrl: versionedUrl })
  }
}

/**
 * Lưu profile name: localStorage + Firebase Firestore.
 */
export async function saveProfileName(walletAddress: string, name: string): Promise<void> {
  const key = walletAddress.toLowerCase()
  localStorage.setItem(`sabi-profile-name-${key}`, name)
  await updateUserProfile(key, { profileName: name })
}
