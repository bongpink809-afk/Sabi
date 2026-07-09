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
  setDoc,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore'
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage'

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
//      title:       string   — tên bill (creator viết lúc tạo)
//      shareNames:  object   — { "0": "Lan Kim", "1": "Bảo" }
//      slotNames:   object   — { "{txHash}": "Tên người góp" }
//      updatedAt:   timestamp
//
//  Collection "users" (hồ sơ — chỉ owner ví này mới cần sync):
//    users/{walletAddress}     ← lowercase, dùng luôn làm document ID
//      profileName: string
//      updatedAt:   timestamp
//
// Security Rules (Firebase Console → Firestore Database → Rules):
//   match /bills/{billId} {
//     allow read: if true;       // ai cũng xem được
//     allow write: if true;      // demo — production nên hạn chế
//   }
//   match /users/{userId} {
//     allow read, write: if true; // demo — production dùng auth
//   }

// ─── Type definitions ──────────────────────────────────────────────────────

export interface BillFirestoreData {
  title?: string
  shareNames?: Record<string, string>
  slotNames?: Record<string, string>
  updatedAt?: unknown
}

export interface UserFirestoreData {
  profileName?: string
  avatarUrl?: string   // URL Firebase Storage — không lưu base64 thắng vào Firestore
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
