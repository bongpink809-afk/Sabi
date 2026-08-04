// src/lib/firebase.ts
// ─── Firebase Firestore — khởi tạo một lần, dùng chung toàn app ───────────
// Credentials đọc từ env (NEXT_PUBLIC_ prefix để Next.js expose ra client-side).
// File .env.local chứa giá trị thật — KHÔNG commit file đó lên git.

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  Firestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore'
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage'
import { nanoid } from 'nanoid'

// ─── Cấu hình Firebase — đọc từ biến môi trường ───────────────────────────
// Lấy giá trị từ https://console.firebase.google.com → Project settings → Your apps
const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Singleton pattern — Next.js hot-reload tạo nhiều module, tránh init nhiều lần
function getFirebaseApp(): FirebaseApp {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig)
  }
  return getApp()
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp())
}

function getStorageInstance() {
  return getStorage(getFirebaseApp())
}

// ─── Cấu trúc Firestore ────────────────────────────────────────────────────
//
//  Collection "bills" (dữ liệu bill — public, ai có billId cũng đọc được):
//    bills/{billId}
//      title:             string  — tên bill (creator viết lúc tạo, client ghi)
//      shareNames:        object  — { "0": "Lan Kim", "1": "Bảo" } (client ghi)
//      slotNames:         object  — { "{txHash}": "Tên người góp" } (client ghi, dữ liệu cũ)
//      updatedAt:         timestamp
//      ─── Phần dưới do script scripts/sync-firestore.mjs ghi (Admin SDK), đọc thẳng
//      từ chain — KHÔNG ghi tay từ client, tránh script ghi đè lẫn nhau ───────────
//      organizer:         string  — lowercase
//      mode:              number  — 0 = ASSIGNED, 1 = OPEN_SLOT (khớp enum contract)
//      totalAmount:       string  — uint256 dạng string (base units, 6 decimals)
//      amountPerSlot:     string
//      numSlots:          number
//      matchedSlotsCount: number
//      extraReceived:     string
//      txHash:            string  — tx tạo bill (BillCreated)
//      blockNumber:       number
//      contributions:     BillContributionDoc[]  — mode OPEN_SLOT
//      shares:            BillShareDoc[]         — mode ASSIGNED, luôn đủ numSlots phần tử
//      ─── Field dưới do CLIENT ghi (lúc tạo bill, hoặc lazy-backfill lần đầu mở
//      bill cũ) — không phải script indexer ───────────────────────────────────
//      shareCode:         string  — mã ngẫu nhiên dùng làm URL chia sẻ public,
//                                    thay cho billId số tuần tự (chống dò link)
//
//  Collection "payments" (1 doc/lượt trả — dùng để tra "user X đã trả những gì",
//  Firestore không query tốt trên field lồng trong array nên tách riêng):
//    payments/{txHash}-{logIndex}
//      billId, shareId (null nếu OPEN_SLOT), payer, amount, matched, txHash, blockNumber
//
//  Collection "shareCodes" (mapping ngược shareCode → billId, để resolve URL
//  công khai bằng đúng 1 lệnh getDoc, không cần query field trong "bills"):
//    shareCodes/{shareCode}     ← shareCode chính là document ID
//      billId: string
//
//  Collection "users" (hồ sơ — chỉ owner ví này mới cần sync):
//    users/{walletAddress}     ← lowercase, dùng luôn làm document ID
//      profileName: string
//      updatedAt:   timestamp
//
//  Collection "emailWallets" (mapping đăng nhập email → ví Circle):
//    emailWallets/{email}      ← lowercase, dùng luôn làm document ID
//      walletAddress: string   — lowercase
//      walletId:      string   — id nội bộ của Circle
//      updatedAt:     timestamp
//
// Security Rules (Firebase Console → Firestore Database → Rules):
//   match /bills/{billId} {
//     allow read: if true;       // ai cũng xem được
//     allow write: if true;      // demo — production nên hạn chế
//   }
//   match /users/{userId} {
//     allow read, write: if true; // demo — production dùng auth
//   }
//   match /emailWallets/{email} {
//     allow read, write: if true; // demo — production dùng auth
//   }
//   match /payments/{paymentId} {
//     allow read: if true;   // client chỉ đọc — chỉ scripts/sync-firestore.mjs
//     allow write: if false; // (Admin SDK) mới ghi được, bypass rule này
//   }
//   match /shareCodes/{shareCode} {
//     allow read, write: if true; // demo — production nên hạn chế
//   }

// ─── Type definitions ──────────────────────────────────────────────────────

export interface BillContributionDoc {
  payer: string
  amount: string
  matched: boolean
  txHash: string
  blockNumber: number
}

export interface BillShareDoc {
  shareId: number
  amount: string
  paid: boolean
  payer: string | null
  txHash: string | null
  blockNumber: number | null
}

export interface BillFirestoreData {
  title?: string
  shareNames?: Record<string, string>
  slotNames?: Record<string, string>
  updatedAt?: unknown
  // Dữ liệu on-chain — do scripts/sync-firestore.mjs ghi, xem giải thích ở
  // comment "Cấu trúc Firestore" phía trên.
  organizer?: string
  mode?: number
  totalAmount?: string
  amountPerSlot?: string
  numSlots?: number
  matchedSlotsCount?: number
  extraReceived?: string
  txHash?: string
  blockNumber?: number
  contributions?: BillContributionDoc[]
  shares?: BillShareDoc[]
  // Do CLIENT ghi (tạo bill / lazy-backfill), xem comment "shareCodes" phía trên.
  shareCode?: string
}

export interface PaymentDoc {
  billId: string
  shareId: number | null
  payer: string
  amount: string
  matched: boolean | null
  txHash: string
  blockNumber: number
}

export interface UserFirestoreData {
  profileName?: string
  avatarUrl?: string   // URL Firebase Storage — không lưu base64 thắng vào Firestore
  updatedAt?: unknown
}

export interface EmailWalletFirestoreData {
  walletAddress?: string
  walletId?: string
  updatedAt?: unknown
}

// ─── API: Bills ────────────────────────────────────────────────────────────

/**
 * Lưu/merge dữ liệu bill lên Firestore.
 */
export async function updateBillData(
  billId: string,
  data: Partial<BillFirestoreData>
): Promise<void> {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return
  try {
    const db = getDb()
    await setDoc(
      doc(db, 'bills', billId),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true }
    )
  } catch (err) {
    console.warn('[Firebase] updateBillData failed:', err)
  }
}

/**
 * Resolve shareCode (mã trong URL chia sẻ, vd `/bill/aB3xQ...`) → billId thật.
 * Trả `null` nếu không tồn tại HOẶC lỗi — bên gọi không được phân biệt 2
 * trường hợp này khi hiển thị (tránh lộ qua thông báo lỗi việc shareCode có
 * từng tồn tại hay không).
 */
export async function resolveShareCode(shareCode: string): Promise<string | null> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return null
  try {
    const db = getDb()
    const snap = await getDoc(doc(db, 'shareCodes', shareCode))
    if (!snap.exists()) return null
    const data = snap.data() as { billId?: string }
    return data.billId ?? null
  } catch (err) {
    console.warn('[Firebase] resolveShareCode failed:', err)
    return null
  }
}

/**
 * Sinh 1 shareCode ngẫu nhiên mới cho bill, ghi vào cả `bills/{billId}.shareCode`
 * lẫn mapping ngược `shareCodes/{shareCode}` → `{billId}`. Dùng chung cho lúc
 * tạo bill mới (create.tsx) VÀ lazy-backfill cho bill cũ chưa có shareCode
 * (bill/[id].tsx, lần đầu ai đó mở trang) — xem memory/project_sabi_phase1.md
 * để biết vì sao không dùng script backfill riêng.
 */
export async function generateAndSaveShareCode(billId: string): Promise<string> {
  const shareCode = nanoid(12)
  const db = getDb()
  await Promise.all([
    updateBillData(billId, { shareCode }),
    setDoc(doc(db, 'shareCodes', shareCode), { billId }),
  ])
  return shareCode
}

/**
 * Batch fetch nhiều bill title cùng lúc — dùng trong trang Profile để hiện tên
 * các bill mà user đã tạo. Trả về map billId → title (chỉ những bill có title).
 */
export async function fetchBillTitles(
  billIds: string[]
): Promise<Record<string, string>> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return {}
  try {
    const db = getDb()
    const results: Record<string, string> = {}
    // Song song để không chờ tuần tự
    await Promise.all(
      billIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'bills', id))
        if (snap.exists()) {
          const data = snap.data() as BillFirestoreData
          if (data.title) {
            results[id] = data.title
            // Cập nhật localStorage luôn để lần sau đọc nhanh hơn
            localStorage.setItem(`sabi-bill-${id}-title`, data.title)
          }
        }
      })
    )
    return results
  } catch (err) {
    console.warn('[Firebase] fetchBillTitles failed:', err)
    return {}
  }
}

/**
 * Batch fetch shareCode của nhiều bill cùng lúc — dùng ở trang Profile cho danh
 * sách "Bills paid" (bill người dùng TRẢ VÀO, không chắc trùng với bill họ TẠO
 * nên không có sẵn shareCode như `CreatedBill`). Trả về map billId → shareCode
 * (chỉ những bill đã có shareCode).
 */
export async function fetchShareCodesByBillIds(
  billIds: string[]
): Promise<Record<string, string>> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return {}
  try {
    const db = getDb()
    const results: Record<string, string> = {}
    await Promise.all(
      billIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'bills', id))
        if (snap.exists()) {
          const data = snap.data() as BillFirestoreData
          if (data.shareCode) results[id] = data.shareCode
        }
      })
    )
    return results
  } catch (err) {
    console.warn('[Firebase] fetchShareCodesByBillIds failed:', err)
    return {}
  }
}

/**
 * Lắng nghe realtime cho 1 bill cụ thể.
 * Trả về hàm unsubscribe — gọi khi component unmount để dọn listener.
 *
 * @example
 * const unsub = listenToBill('12', (data) => {
 *   if (data.title) setBillTitle(data.title)
 *   if (data.shareNames) setShareNames(data.shareNames)
 * })
 * // cleanup:
 * return () => unsub()
 */
export function listenToBill(
  billId: string,
  callback: (data: BillFirestoreData) => void
): Unsubscribe {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return () => {}
  const db = getDb()
  return onSnapshot(
    doc(db, 'bills', billId),
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as BillFirestoreData)
      }
    },
    (err) => {
      console.warn('[Firebase] listenToBill error:', err)
    }
  )
}

/**
 * Lấy toàn bộ bill do 1 địa chỉ ví tạo (field `organizer`, do sync-firestore.mjs
 * ghi) — thay cho việc quét event BillCreated qua RPC ở trang Profile.
 */
export async function fetchBillsByOrganizer(
  address: string
): Promise<Array<{ billId: string } & BillFirestoreData>> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return []
  try {
    const db = getDb()
    const q = query(collection(db, 'bills'), where('organizer', '==', address.toLowerCase()))
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ billId: d.id, ...(d.data() as BillFirestoreData) }))
  } catch (err) {
    console.warn('[Firebase] fetchBillsByOrganizer failed:', err)
    return []
  }
}

/**
 * Lấy toàn bộ lượt trả (SharePaid/SlotFilled) của 1 địa chỉ ví — collection
 * "payments" riêng vì Firestore không query tốt trên field lồng trong array
 * (contributions[].payer / shares[].payer nằm trong doc bill).
 */
export async function fetchPaymentsByPayer(address: string): Promise<PaymentDoc[]> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return []
  try {
    const db = getDb()
    const q = query(collection(db, 'payments'), where('payer', '==', address.toLowerCase()))
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data() as PaymentDoc)
  } catch (err) {
    console.warn('[Firebase] fetchPaymentsByPayer failed:', err)
    return []
  }
}

// ─── API: User profile ─────────────────────────────────────────────────────

/**
 * Upload avatar (base64 dataUrl) lên Firebase Storage.
 * Trả về download URL để lưu vào Firestore + hiển thị.
 * Firebase Storage lưu file thực — Firestore chỉ lưu URL (tiết kiệm dung lượng document).
 */
export async function uploadAvatar(
  walletAddress: string,
  base64DataUrl: string
): Promise<string | null> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return null
  try {
    const storage = getStorageInstance()
    // Path: avatars/{walletAddress} — mỗi user 1 file, tự ghi đè khi đổi avatar
    const avatarRef = ref(storage, `avatars/${walletAddress.toLowerCase()}`)
    await uploadString(avatarRef, base64DataUrl, 'data_url')
    const downloadUrl = await getDownloadURL(avatarRef)
    return downloadUrl
  } catch (err) {
    console.warn('[Firebase] uploadAvatar failed:', err)
    return null
  }
}

/**
 * Batch fetch hồ sơ (profileName, avatarUrl) của nhiều địa chỉ ví cùng lúc —
 * dùng để hiện avatar/tên của người trả trong hoá đơn (khác ví đang connect,
 * nên không dùng listenToUserProfile — hook đó chỉ realtime cho 1 ví).
 */
export async function fetchUserProfiles(
  addresses: string[]
): Promise<Record<string, UserFirestoreData>> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return {}
  try {
    const db = getDb()
    const results: Record<string, UserFirestoreData> = {}
    const uniqueAddresses = Array.from(new Set(addresses.map((a) => a.toLowerCase())))
    await Promise.all(
      uniqueAddresses.map(async (addr) => {
        const snap = await getDoc(doc(db, 'users', addr))
        if (snap.exists()) {
          results[addr] = snap.data() as UserFirestoreData
        }
      })
    )
    return results
  } catch (err) {
    console.warn('[Firebase] fetchUserProfiles failed:', err)
    return {}
  }
}

/**
 * Lưu/merge hồ sơ user (profileName, avatarUrl) lên Firestore theo địa chỉ ví.
 */
export async function updateUserProfile(
  walletAddress: string,
  data: Partial<UserFirestoreData>
): Promise<void> {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return
  try {
    const db = getDb()
    await setDoc(
      doc(db, 'users', walletAddress.toLowerCase()),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true }
    )
  } catch (err) {
    console.warn('[Firebase] updateUserProfile failed:', err)
  }
}

/**
 * Lắng nghe realtime hồ sơ user.
 * Dùng trong useEffect khi wallet connect — tự cập nhật UI khi profile đổi từ thiết bị khác.
 *
 * @example
 * const unsub = listenToUserProfile('0xabc...', (data) => {
 *   if (data.profileName) setProfileName(data.profileName)
 * })
 * return () => unsub()
 */
export function listenToUserProfile(
  walletAddress: string,
  callback: (data: UserFirestoreData) => void
): Unsubscribe {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return () => {}
  const db = getDb()
  return onSnapshot(
    doc(db, 'users', walletAddress.toLowerCase()),
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as UserFirestoreData)
      }
    },
    (err) => {
      console.warn('[Firebase] listenToUserProfile error:', err)
    }
  )
}

// ─── API: Email ↔ ví Circle (đăng nhập bằng email) ─────────────────────────
// Chỉ là mapping tiện ích cho app (vd tra cứu sau này) — KHÔNG nằm trên
// critical path của luồng đăng nhập/thanh toán, nguồn sự thật vẫn là Circle's
// GET /v1/w3s/wallets. Lỗi ghi ở đây không được chặn đăng nhập.

/**
 * Lưu/merge mapping email → ví Circle vừa tạo/tìm thấy.
 */
export async function saveEmailWalletMapping(
  email: string,
  walletAddress: string,
  walletId: string
): Promise<void> {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return
  try {
    const db = getDb()
    await setDoc(
      doc(db, 'emailWallets', email.toLowerCase()),
      { walletAddress: walletAddress.toLowerCase(), walletId, updatedAt: serverTimestamp() },
      { merge: true }
    )
  } catch (err) {
    console.warn('[Firebase] saveEmailWalletMapping failed:', err)
  }
}

/**
 * Tra cứu ví Circle đã gắn với 1 email.
 */
export async function fetchEmailWallet(email: string): Promise<EmailWalletFirestoreData | null> {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return null
  try {
    const db = getDb()
    const snap = await getDoc(doc(db, 'emailWallets', email.toLowerCase()))
    return snap.exists() ? (snap.data() as EmailWalletFirestoreData) : null
  } catch (err) {
    console.warn('[Firebase] fetchEmailWallet failed:', err)
    return null
  }
}
