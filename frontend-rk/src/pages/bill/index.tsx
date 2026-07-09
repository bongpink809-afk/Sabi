import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { SabiHeader } from '../../components/SabiHeader'
import { colors, radius } from '../../styles/theme'

export const getStaticProps: GetStaticProps = async ({ locale }) => ({
  props: { ...(await serverSideTranslations(locale ?? 'en', ['common'])) },
})

// Trang trống cho tab "Chi tiết bill" khi user chưa từng tạo/xem bill nào —
// không thể dùng /bill/[id].tsx vì route đó bắt buộc phải có id thật.
const BillEmpty: NextPage = () => {
  const { t } = useTranslation('common')
  return (
    <>
      <Head>
        <title>{t('bill.empty_page_title')}</title>
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
          {t('bill.empty_state')}
        </div>
      </main>
    </>
  )
}

export default BillEmpty
