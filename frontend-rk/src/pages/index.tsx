import { FC, SVGProps, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { Plus_Jakarta_Sans, Playfair_Display } from 'next/font/google'
import { SabiLogo } from '../components/SabiLogo'
import { LocaleSwitcher } from '../components/SabiHeader'
import { useLandingStats } from '../hooks/useLandingStats'

export const getServerSideProps: GetServerSideProps = async ({ locale }) => ({
  props: { ...(await serverSideTranslations(locale ?? 'en', ['common'])) },
})

// Landing page — hero "Share bill for Everyone" + 3 use case + nav (Faucet/Feedback/
// ngôn ngữ) + Process/Stats/FAQ (thêm mới theo sabi-landing-v2-demo.html). Bảng màu/font
// riêng cho trang này, đã chốt qua bản preview HTML (xem HANDOFF.md), khác với theme.ts
// của app (không dùng colors.primary ở đây vì đây là màu landing đo trực tiếp từ ảnh
// tham khảo, không phải theme chung). Hero + Use Case giữ nguyên màu đã duyệt trước đó
// (c.accent/c.heading/...) — 3 token dark/purple thêm mới CHỈ dùng cho Process/Stats.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'] })
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'], style: ['italic'] })

const c = {
  accent: '#998EFF',
  heading: '#3E383E',
  body: '#706C73',
  caption: '#8A8699',
  badgeText: '#5B5766',
  // Thêm cho Process (nền đen) + Stats (nền tím gradient) — theo đúng token trong demo
  blackCard: '#0B0E1A',
  violet: '#7C6FEF',
  violetDeep: '#6C5CE7',
}

const IconBowl: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
    <path d="M3 11h18a9 9 0 0 1-18 0Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 11V4M8.5 6 12 4l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 15c1.2 1.6 3 2.5 7 2.5s5.8-.9 7-2.5" strokeLinecap="round" />
  </svg>
)

const IconCart: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M2.5 3h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconUsers: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 19c.6-3.4 3-5.2 6.2-5.2s5.6 1.8 6.2 5.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="17.5" cy="9" r="2.4" />
    <path d="M15.6 13.6c2.4.2 4 1.8 4.5 4.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

type UseCase = {
  id: string
  icon: FC<SVGProps<SVGSVGElement>>
  titleKey: string
  descKey: string
  rotate: number
}

const useCases: UseCase[] = [
  { id: 'group-meal', icon: IconBowl, titleKey: 'landing.usecase_meal_title', descKey: 'landing.usecase_meal_desc', rotate: -6 },
  { id: 'group-buy', icon: IconCart, titleKey: 'landing.usecase_purchase_title', descKey: 'landing.usecase_purchase_desc', rotate: 3 },
  { id: 'club-fund', icon: IconUsers, titleKey: 'landing.usecase_club_title', descKey: 'landing.usecase_club_desc', rotate: -3 },
]

const Landing: FC = () => {
  const { t } = useTranslation('common')

  return (
    <div className={jakarta.className} style={{ background: '#F6F6FA' }}>
      <Head>
        <title>Sabi — Share bill for Everyone</title>
      </Head>

      <div className="landing-wrap">
        <div className="blob blob-1" />
        <div className="blob blob-2" />

        <nav className="nav-row">
          <div className="nav-logo">
            <SabiLogo size={24} />
            <span className="nav-logo-text">Sabi</span>
          </div>
          <div className="nav-links">
            <a className="nav-link" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">
              {t('landing.nav_faucet')}
            </a>
            <a
              className="nav-link"
              href="https://docs.google.com/forms/d/e/1FAIpQLScWuvJDelu5jk0gU4T0pUsjUt9WXheXT4lUyzlReikUkX8t4Q/viewform?usp=publish-editor"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('landing.nav_feedback')}
            </a>
            <LocaleSwitcher />
          </div>
        </nav>

        {/* HERO */}
        <section className="hero">
          <div className="hero-inner">
            <h1 className="headline">
              {t('landing.hero_title_pre')}{' '}
              <span className={playfair.className} style={{ fontWeight: 600, color: c.accent }}>
                {t('landing.hero_title_em')}
              </span>
            </h1>

            <p className="subtitle">{t('landing.hero_subtitle')}</p>

            <div className="cta-row">
              <Link href="/create" className="cta">
                {t('landing.hero_cta')}
              </Link>
            </div>
          </div>
        </section>

        {/* USE CASES */}
        <section id="use-cases" className="usecases">
          <div className="usecases-inner">
            <p className="usecases-label">{t('landing.usecase_eyebrow')}</p>
            <p className="usecases-heading">{t('landing.usecase_heading')}</p>

            <div className="usecases-grid">
              {useCases.map(({ id, icon: Icon, titleKey, descKey, rotate }) => (
                <div key={id} className="usecase-card" style={{ '--rotate': `${rotate}deg` } as React.CSSProperties}>
                  <div className="usecase-icon">
                    <Icon style={{ height: 28, width: 28 }} />
                  </div>
                  <h3 className="usecase-title">{t(titleKey)}</h3>
                  <p className="usecase-desc">{t(descKey)}</p>
                </div>
              ))}
            </div>

          </div>
        </section>
      </div>

      <div className="page">
        <ProcessSection />
        <StatsSection />
        <FaqSection />
      </div>

      <style jsx>{`
        .landing-wrap {
          position: relative;
          overflow: hidden;
          background: linear-gradient(to bottom, #ffffff, #f8f7ff, #f6f6fa);
        }
        .blob {
          pointer-events: none;
          position: absolute;
          border-radius: 9999px;
          background: ${c.accent};
        }
        .blob-1 {
          top: 40px;
          left: 50%;
          height: 480px;
          width: 480px;
          transform: translateX(-50%);
          opacity: 0.12;
          filter: blur(120px);
        }
        .blob-2 {
          top: 560px;
          right: -96px;
          height: 288px;
          width: 288px;
          opacity: 0.1;
          filter: blur(100px);
        }

        .nav-row {
          position: relative;
          max-width: 1080px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 24px 24px 0;
          gap: 12px;
          flex-wrap: wrap;
        }
        .nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .nav-logo-text {
          font-size: 15px;
          font-weight: 700;
          color: ${c.heading};
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .hero {
          position: relative;
          padding: 56px 24px 32px;
          text-align: center;
        }
        .hero-inner {
          position: relative;
          margin: 0 auto;
          max-width: 768px;
        }
        .headline {
          margin: 0;
          font-size: 48px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: ${c.heading};
          line-height: 1.1;
          text-wrap: balance;
        }
        @media (min-width: 768px) {
          .headline {
            font-size: 60px;
          }
        }
        .subtitle {
          margin: 24px auto 0;
          max-width: 576px;
          font-size: 18px;
          color: ${c.body};
        }
        .cta-row {
          margin-top: 36px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .usecases {
          position: relative;
          padding: 32px 24px 28px;
        }
        .usecases-inner {
          position: relative;
          margin: 0 auto;
          max-width: 1024px;
        }
        .usecases-label {
          margin: 0 0 12px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: ${c.caption};
        }
        .usecases-heading {
          margin: 0 0 64px;
          font-size: 20px;
          font-weight: 700;
          color: ${c.heading};
          text-wrap: balance;
        }
        @media (min-width: 768px) {
          .usecases-heading {
            font-size: 24px;
          }
        }
        .usecases-grid {
          display: grid;
          gap: 32px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 768px) {
          .usecases-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        .usecase-card {
          position: relative;
          border-radius: 24px;
          border: 1px solid #ffffff;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(8px);
          padding: 32px;
          box-shadow: 0 20px 45px -20px rgba(153, 142, 255, 0.45);
          transition: transform 0.3s, box-shadow 0.3s;
        }
        .usecase-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 28px 55px -18px rgba(153, 142, 255, 0.55);
        }
        .usecase-icon {
          display: flex;
          height: 56px;
          width: 56px;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background: ${c.accent};
          color: #ffffff;
          box-shadow: 0 10px 20px -5px rgba(153, 142, 255, 0.4);
          transform: rotate(var(--rotate));
          transition: transform 0.3s;
        }
        .usecase-card:hover .usecase-icon {
          transform: rotate(0deg);
        }
        .usecase-title {
          margin: 24px 0 0;
          font-size: 20px;
          font-weight: 700;
          color: ${c.heading};
        }
        .usecase-desc {
          margin: 8px 0 0;
          font-size: 14px;
          line-height: 1.6;
          color: ${c.body};
        }
        .page {
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 24px;
        }
      `}</style>

      {/* Global — next/link render ra thẻ <a> nằm ngoài phạm vi scope của
          styled-jsx phía trên (scope chỉ bám vào element viết trực tiếp
          trong component này), nên riêng nút CTA + nav-link phải style qua global. */}
      <style jsx global>{`
        .cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 9999px;
          background: ${c.accent};
          padding: 14px 28px;
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          box-shadow: 0 10px 25px -5px rgba(153, 142, 255, 0.3);
          transition: transform 0.2s;
        }
        .cta:hover {
          transform: scale(1.03);
        }
        .nav-link {
          font-size: 13px;
          font-weight: 600;
          color: ${c.heading};
          text-decoration: none;
          padding: 8px 14px;
          border-radius: 999px;
          transition: background 0.15s ease;
        }
        .nav-link:hover {
          background: rgba(124, 111, 239, 0.1);
        }
      `}</style>
    </div>
  )
}

// ─── Process — khối nền đen, 4 bước, track/packet chạy bằng CSS keyframes
// thuần (không cần JS), khớp sabi-landing-v2-demo.html. Icon giữ nguyên path
// SVG từ demo.
function ProcessSection() {
  const { t } = useTranslation('common')
  const steps = [
    {
      title: t('landing.process_step1_title'),
      desc: t('landing.process_step1_desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="13" rx="3" stroke="white" strokeWidth={1.6} />
          <path d="M3 10h18" stroke="white" strokeWidth={1.6} />
          <circle cx="16" cy="14.5" r="1.4" fill="white" />
        </svg>
      ),
    },
    {
      title: t('landing.process_step2_title'),
      desc: t('landing.process_step2_desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M8 4h10a2 2 0 012 2v13l-4-2-4 2-4-2-4 2V8a2 2 0 012-2h0"
            stroke="white"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <path d="M9 9h6M9 12.5h6" stroke="white" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: t('landing.process_step3_title'),
      desc: t('landing.process_step3_desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zm12 6a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 3.9M15.4 6.6L8.6 10.5"
            stroke="white"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      title: t('landing.process_step4_title'),
      desc: t('landing.process_step4_desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="white" strokeWidth={1.6} />
          <path d="M8 12.3l2.6 2.6L16 9.5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ]

  return (
    <div className="block-wrap">
      <div className="card-dark">
        <div className="card-head">
          <div className="eyebrow">{t('landing.process_eyebrow')}</div>
          <h2>{t('landing.process_title')}</h2>
          <p>{t('landing.process_subtitle')}</p>
        </div>

        <div className="track-wrap">
          <div className="track-line" />
          <div className="track-progress">
            <div className="packet" />
          </div>

          <div className="steps">
            {steps.map((step, i) => (
              <div className="step" key={i}>
                <div className="step-icon">
                  <span className="step-num">{i + 1}</span>
                  {step.icon}
                </div>
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card-foot">
          {t('landing.process_foot_pre')} <b>{t('landing.process_foot_bold')}</b> {t('landing.process_foot_post')}
        </div>
      </div>

      <style jsx>{`
        .block-wrap {
          padding: 28px 0;
        }
        .card-dark {
          background: radial-gradient(60% 80% at 100% 0%, rgba(124, 111, 239, 0.25) 0%, rgba(124, 111, 239, 0) 55%), ${c.blackCard};
          border-radius: 32px;
          padding: 56px 40px 60px;
          color: white;
          position: relative;
          overflow: hidden;
        }
        .card-head {
          margin-bottom: 52px;
        }
        .eyebrow {
          font-size: 11.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 14px;
          color: #a79bff;
        }
        .card-head h2 {
          font-size: clamp(22px, 3vw, 30px);
          font-weight: 700;
          line-height: 1.35;
          margin: 0 0 12px;
          color: white;
          text-wrap: balance;
        }
        .card-head p {
          font-size: 13.5px;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.7;
          margin: 0;
          max-width: 620px;
        }
        .track-wrap {
          position: relative;
        }
        .track-line {
          position: absolute;
          top: 46px;
          left: 60px;
          right: 60px;
          height: 2px;
          background: repeating-linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.14) 0,
            rgba(255, 255, 255, 0.14) 6px,
            transparent 6px,
            transparent 12px
          );
          z-index: 0;
        }
        .track-progress {
          position: absolute;
          top: 46px;
          left: 60px;
          right: 60px;
          height: 2px;
          z-index: 0;
          overflow: hidden;
        }
        .packet {
          position: absolute;
          top: -5px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${c.accent};
          box-shadow: 0 0 0 6px rgba(153, 142, 255, 0.18), 0 0 20px rgba(153, 142, 255, 0.8);
          animation: travel 4.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @keyframes travel {
          0% {
            left: 0%;
            background: ${c.accent};
          }
          35% {
            left: 33.3%;
            background: ${c.violet};
          }
          65% {
            left: 66.6%;
            background: #a79bff;
          }
          100% {
            left: 100%;
            background: ${c.accent};
            box-shadow: 0 0 0 6px rgba(153, 142, 255, 0.22), 0 0 22px rgba(153, 142, 255, 0.85);
          }
        }
        .steps {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }
        .step {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 0 8px;
        }
        .step-icon {
          width: 88px;
          height: 88px;
          border-radius: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          position: relative;
          background: linear-gradient(145deg, rgba(153, 142, 255, 0.16), rgba(153, 142, 255, 0.06));
          border: 1px solid rgba(153, 142, 255, 0.25);
        }
        .step:hover .step-icon {
          transform: translateY(-4px);
          box-shadow: 0 14px 30px rgba(153, 142, 255, 0.3);
        }
        .step-icon :global(svg) {
          width: 30px;
          height: 30px;
        }
        .step-num {
          position: absolute;
          top: -8px;
          right: -8px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: ${c.violet};
          color: white;
          font-size: 11px;
          font-weight: 800;
          border: 2px solid ${c.blackCard};
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .step-title {
          font-size: 14.5px;
          font-weight: 700;
          color: white;
          margin-bottom: 6px;
        }
        .step-desc {
          font-size: 12.5px;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.55;
        }
        .card-foot {
          text-align: center;
          margin-top: 48px;
          font-size: 12.5px;
          color: rgba(255, 255, 255, 0.5);
        }
        .card-foot :global(b) {
          color: white;
        }
        @media (max-width: 760px) {
          .steps {
            grid-template-columns: 1fr;
            gap: 40px;
          }
          .track-line,
          .track-progress {
            display: none;
          }
          .step-icon {
            width: 76px;
            height: 76px;
          }
          .card-dark {
            padding: 40px 22px 44px;
            border-radius: 24px;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Stats — khối nền tím gradient, 4 tile. "Bills created" + "USDC settled"
// nối data thật qua useLandingStats (quét toàn bộ lịch sử on-chain, không lọc
// theo ví). "Source chains supported" (3) và "Average settlement time" (~20s)
// là thông tin sản phẩm cố định, không phải số liệu đọc từ chain.
function StatsSection() {
  const { t } = useTranslation('common')
  const stats = useLandingStats()

  return (
    <div className="block-wrap">
      <div className="card-purple">
        <div className="stat-head">
          <div className="eyebrow">{t('landing.stats_eyebrow')}</div>
          <h2>{t('landing.stats_title')}</h2>
          <p>{t('landing.stats_subtitle')}</p>
        </div>
        <div className="stat-grid">
          <StatTile target={stats.billsCreated} label={t('landing.stats_bills_created_label')} ready={!stats.isLoading} />
          <StatTile
            target={stats.usdcSettled}
            format="comma"
            label={t('landing.stats_usdc_settled_label')}
            ready={!stats.isLoading}
          />
          <StatTile target={3} label={t('landing.stats_chains_label')} />
          <StatTile target={20} prefix="~" suffix="s" label={t('landing.stats_settlement_label')} />
        </div>
      </div>

      <style jsx>{`
        .block-wrap {
          padding: 28px 0;
        }
        .card-purple {
          background: linear-gradient(135deg, ${c.violet} 0%, ${c.violetDeep} 55%, #5a4bd6 100%);
          border-radius: 32px;
          padding: 52px 40px 56px;
          color: white;
        }
        .stat-head {
          max-width: 560px;
          margin-bottom: 40px;
        }
        .eyebrow {
          font-size: 11.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 14px;
          color: rgba(255, 255, 255, 0.75);
        }
        .stat-head h2 {
          font-size: clamp(22px, 3vw, 28px);
          font-weight: 700;
          margin: 0 0 10px;
          text-wrap: balance;
        }
        .stat-head p {
          font-size: 13.5px;
          color: rgba(255, 255, 255, 0.75);
          line-height: 1.6;
          margin: 0;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
        @media (max-width: 760px) {
          .stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .card-purple {
            padding: 40px 22px 44px;
            border-radius: 24px;
          }
        }
      `}</style>
    </div>
  )
}

function StatTile({
  target,
  label,
  prefix = '',
  suffix = '',
  format,
  ready = true,
}: {
  target: number
  label: string
  prefix?: string
  suffix?: string
  format?: 'comma'
  ready?: boolean
}) {
  const tileRef = useRef<HTMLDivElement>(null)
  const numRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
  const animatedRef = useRef(false)

  useEffect(() => {
    const el = tileRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRevealed(true)
            observer.unobserve(el)
          }
        })
      },
      { threshold: 0.2 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Chỉ chạy count-up khi ĐÃ cuộn tới (revealed) VÀ data thật đã sẵn sàng
  // (ready) — 2 tile "Bills created"/"USDC settled" tới sau vì phải chờ RPC,
  // nếu chạy ngay lúc revealed sẽ animate về 0 trước khi data kịp tới.
  useEffect(() => {
    if (!revealed || !ready || animatedRef.current || !numRef.current) return
    animatedRef.current = true
    const el = numRef.current
    const duration = 1100
    const start = performance.now()
    function frame(now: number) {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const value = Math.round(target * eased)
      const display = format === 'comma' ? value.toLocaleString('en-US') : String(value)
      el.textContent = prefix + display + suffix
      if (progress < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, [revealed, ready, target, prefix, suffix, format])

  return (
    <div ref={tileRef} className={`stat-tile ${revealed ? 'reveal' : ''}`}>
      <div ref={numRef} className="stat-num">
        {ready ? `${prefix}0${suffix}` : '…'}
      </div>
      <div className="stat-label">{label}</div>

      <style jsx>{`
        .stat-tile {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 18px;
          padding: 22px 20px;
          opacity: 0;
          transform: translateY(22px) scale(0.97);
          transition: opacity 0.55s ease, transform 0.55s ease, background 0.25s ease, border-color 0.25s ease;
        }
        .stat-tile.reveal {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .stat-tile:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.35);
          transform: translateY(-4px) scale(1);
        }
        .stat-num {
          font-size: clamp(24px, 3.4vw, 32px);
          font-weight: 800;
          color: white;
          margin-bottom: 6px;
        }
        .stat-label {
          font-size: 11.5px;
          color: rgba(255, 255, 255, 0.7);
          line-height: 1.4;
        }
      `}</style>
    </div>
  )
}

// ─── FAQ — accordion trắng, 5 câu, chỉ mở 1 câu tại 1 thời điểm (giống demo).
function FaqSection() {
  const { t } = useTranslation('common')
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const items = [1, 2, 3, 4].map((n) => ({
    q: t(`landing.faq_q${n}`),
    a: t(`landing.faq_a${n}`),
  }))

  return (
    <section className="faq">
      <div className="faq-head">
        <div className="eyebrow">{t('landing.faq_eyebrow')}</div>
        <h2>{t('landing.faq_title')}</h2>
        <p>{t('landing.faq_subtitle')}</p>
      </div>

      {items.map((item, i) => {
        const open = openIndex === i
        return (
          <div className={`faq-item ${open ? 'open' : ''}`} key={i}>
            <button className="faq-q" onClick={() => setOpenIndex(open ? null : i)}>
              {item.q}
              <span className="plus">+</span>
            </button>
            <div className="faq-a">
              <p>{item.a}</p>
            </div>
          </div>
        )
      })}

      <style jsx>{`
        .faq {
          padding: 80px 0 100px;
        }
        .faq-head {
          max-width: 560px;
          margin-bottom: 36px;
        }
        .eyebrow {
          font-size: 11.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 14px;
          color: ${c.caption};
        }
        .faq-head h2 {
          font-size: clamp(22px, 3vw, 28px);
          font-weight: 700;
          color: ${c.heading};
          margin: 0 0 10px;
          text-wrap: balance;
        }
        .faq-head p {
          font-size: 13.5px;
          color: ${c.body};
          line-height: 1.6;
          margin: 0;
        }
        .faq-item {
          border-bottom: 1px solid #e7e4fa;
        }
        .faq-q {
          width: 100%;
          background: none;
          border: none;
          text-align: left;
          padding: 20px 0;
          font-family: inherit;
          font-size: 14.5px;
          font-weight: 700;
          color: ${c.heading};
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
        }
        .faq-q .plus {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${c.accent};
          font-size: 18px;
          transition: transform 0.25s ease;
        }
        .faq-item.open .faq-q .plus {
          transform: rotate(45deg);
        }
        .faq-a {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        .faq-item.open .faq-a {
          max-height: 200px;
        }
        .faq-a p {
          font-size: 13px;
          color: ${c.body};
          line-height: 1.7;
          padding-bottom: 20px;
          margin: 0;
        }
      `}</style>
    </section>
  )
}

export default Landing
