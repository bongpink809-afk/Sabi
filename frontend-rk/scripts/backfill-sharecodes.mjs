// Backfill shareCode cho toàn bộ bill hiện có trong Firestore — chạy 1 lần
// TRƯỚC KHI khoá route billId số (pages/bill/[id].tsx chỉ còn nhận shareCode).
// An toàn chạy lại nhiều lần — bill nào đã có shareCode thì bỏ qua.
//
// Cách chạy: node scripts/backfill-sharecodes.mjs (hoặc npm run backfill-sharecodes),
// trong thư mục frontend-rk.

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { nanoid } from 'nanoid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')

if (!projectId || !clientEmail || !privateKey) {
  console.error('Thiếu FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID trong .env.local')
  process.exit(1)
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
const db = getFirestore()

async function main() {
  const [billsSnap, codesSnap] = await Promise.all([
    db.collection('bills').get(),
    db.collection('shareCodes').get(),
  ])
  console.log(`Tổng ${billsSnap.size} bill trong Firestore`)

  // Không chỉ check "đã có field shareCode" — phải xác nhận CÓ THẬT doc mapping
  // ngược trong shareCodes trỏ đúng billId đó. Có trường hợp thật: field shareCode
  // ghi thành công (rule bills mở) nhưng doc shareCodes ghi thất bại (rule
  // shareCodes lúc đó chưa Publish) — "mồ côi" 1 chiều, cần backfill lại từ đầu.
  const validCodeToBillId = new Map(
    codesSnap.docs.map((d) => [d.id, d.data().billId])
  )

  let backfilled = 0
  let alreadyValid = 0

  for (const docSnap of billsSnap.docs) {
    const data = docSnap.data()
    const hasValidMapping = data.shareCode && validCodeToBillId.get(data.shareCode) === docSnap.id
    if (hasValidMapping) {
      alreadyValid++
      continue
    }
    const shareCode = nanoid(12)
    await Promise.all([
      docSnap.ref.set({ shareCode }, { merge: true }),
      db.collection('shareCodes').doc(shareCode).set({ billId: docSnap.id }),
    ])
    const reason = data.shareCode ? `mồ côi (shareCode cũ "${data.shareCode}" không có mapping)` : 'chưa có shareCode'
    console.log(`  ✓ bills/${docSnap.id} -> shareCode ${shareCode} (${reason})`)
    backfilled++
  }

  console.log('--- DONE ---')
  console.log(`Backfill mới/sửa lại: ${backfilled} bill`)
  console.log(`Đã hợp lệ từ trước: ${alreadyValid} bill`)
  console.log(`Tổng: ${backfilled + alreadyValid}/${billsSnap.size}`)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
