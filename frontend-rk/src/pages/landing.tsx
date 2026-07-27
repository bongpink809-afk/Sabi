import { FC, SVGProps } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { Plus_Jakarta_Sans, Playfair_Display } from 'next/font/google'
import { SabiLogo } from '../components/SabiLogo'

// Landing page — hero "Share bill for Everyone" + 3 use case. Bảng màu/font
// riêng cho trang này, đã chốt qua bản preview HTML (xem HANDOFF.md), khác
// với theme.ts của app (không dùng colors.primary ở đây vì đây là màu landing
// đo trực tiếp từ ảnh tham khảo, không phải theme chung).
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'] })
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'], style: ['italic'] })

const c = {
  accent: '#998EFF',
  heading: '#3E383E',
  body: '#706C73',
  caption: '#8A8699',
  badgeText: '#5B5766',
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
  title: string
  description: string
  rotate: number
}

const useCases: UseCase[] = [
  {
    id: 'group-meal',
    icon: IconBowl,
    title: 'Group meals',
    description: 'Split the bill right at the table. Everyone pays from their own chain, done in about 20 seconds.',
    rotate: -6,
  },
  {
    id: 'group-buy',
    icon: IconCart,
    title: 'Group purchases',
    description: 'Bulk orders, split exactly by what each person ordered.',
    rotate: 3,
  },
  {
    id: 'club-fund',
    icon: IconUsers,
    title: 'Club funds',
    description: 'Collect recurring dues and track who has paid — no more spreadsheets.',
    rotate: -3,
  },
]

const Landing: FC = () => {
  return (
    <div className={jakarta.className}>
      <Head>
        <title>Sabi — Share bill for Everyone</title>
      </Head>

      <div className="landing-wrap">
        <div className="blob blob-1" />
        <div className="blob blob-2" />

        {/* HERO */}
        <section className="hero">
          <div className="hero-inner">
            <div className="badge">
              <SabiLogo size={24} />
              <span className="badge-text">Sabi</span>
            </div>

            <h1 className="headline">
              Share bill for{' '}
              <span className={playfair.className} style={{ fontWeight: 600, color: c.accent }}>
                Everyone
              </span>
            </h1>

            <p className="subtitle">
              Split with your group, pay from any chain — settled on Arc in about 20 seconds.
            </p>

            <div className="cta-row">
              <Link href="/" className="cta">
                Create a bill
              </Link>
            </div>
          </div>
        </section>

        {/* USE CASES */}
        <section id="use-cases" className="usecases">
          <div className="usecases-inner">
            <p className="usecases-label">Use case</p>
            <p className="usecases-heading">
              Three everyday group scenarios — everyone pays their share from
              whatever chain they hold, Sabi handles the rest.
            </p>

            <div className="usecases-grid">
              {useCases.map(({ id, icon: Icon, title, description, rotate }) => (
                <div key={id} className="usecase-card" style={{ '--rotate': `${rotate}deg` } as React.CSSProperties}>
                  <div className="usecase-icon">
                    <Icon style={{ height: 28, width: 28 }} />
                  </div>
                  <h3 className="usecase-title">{title}</h3>
                  <p className="usecase-desc">{description}</p>
                </div>
              ))}
            </div>

            <p className="usecases-caption">Arc Testnet · settles in ~20 seconds</p>
          </div>
        </section>
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

        .hero {
          position: relative;
          padding: 80px 24px 32px;
          text-align: center;
        }
        .hero-inner {
          position: relative;
          margin: 0 auto;
          max-width: 768px;
        }
        .badge {
          margin-bottom: 32px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .badge-text {
          font-size: 15px;
          font-weight: 600;
          color: ${c.badgeText};
        }
        .headline {
          margin: 0;
          font-size: 48px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: ${c.heading};
          line-height: 1.1;
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
          padding: 32px 24px 80px;
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
          white-space: nowrap;
          font-size: 20px;
          font-weight: 700;
          color: ${c.heading};
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
        .usecases-caption {
          margin: 56px 0 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          color: ${c.caption};
        }
      `}</style>

      {/* Global — next/link render ra thẻ <a> nằm ngoài phạm vi scope của
          styled-jsx phía trên (scope chỉ bám vào element viết trực tiếp
          trong component này), nên riêng nút CTA phải style qua global. */}
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
      `}</style>
    </div>
  )
}

export default Landing
