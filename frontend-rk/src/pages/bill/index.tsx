import type { NextPage } from 'next'
import Head from 'next/head'
import { SabiHeader } from '../../components/SabiHeader'
import { colors, radius } from '../../styles/theme'

// Trang trống cho tab "Chi tiết bill" khi user chưa từng tạo/xem bill nào —
// không thể dùng /bill/[id].tsx vì route đó bắt buộc phải có id thật.
const BillEmpty: NextPage = () => (
  <>
    <Head>
      <title>Chi tiết bill — Sabi</title>
    </Head>
    <SabiHeader />
    <main style={{ minHeight: '100vh', background: colors.background, padding: '24px 16px' }}>
      <div
        style={{
          maxWidth: 480,
          margin: '80px auto 0',
          textAlign: 'center',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.card,
          padding: 32,
          color: colors.textSecondary,
          fontSize: 14,
        }}
      >
        Chưa có bill nào để xem chi tiết — tạo bill mới hoặc mở link 1 bill có sẵn.
      </div>
    </main>
  </>
)

export default BillEmpty
