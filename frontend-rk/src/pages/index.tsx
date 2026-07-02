import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { colors } from '../styles/theme';

const Home: NextPage = () => {
  const router = useRouter();

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>Sabi</title>
      </Head>

      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 80px',
        borderBottom: `1px solid ${colors.borderLight}`,
      }}>
        <strong style={{ fontSize: 20, color: colors.primary }}>Sabi</strong>
        <ConnectButton />
      </nav>

      <main style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        alignItems: 'center',
        padding: '0 80px',
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 'calc(100vh - 57px)',
      }}>

        <div style={{ paddingRight: 60 }}>
          <h1 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.15, marginBottom: 20, color: colors.textPrimary }}>
            Share Bill Dapp
          </h1>
          <p style={{ fontSize: 18, color: colors.textSecondary, marginBottom: 40, lineHeight: 1.6 }}>
            Pay with USDC from any chain.
          </p>

          <button
            onClick={() => router.push('/create')}
            style={{
              background: colors.primary,
              color: colors.surface,
              border: 'none',
              padding: '16px 40px',
              fontSize: 17,
              fontWeight: 600,
              borderRadius: 10,
              cursor: 'pointer',
              marginBottom: 56,
            }}
          >
            Create bill →
          </button>

          <p style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: 2, marginBottom: 16 }}>
            HOW IT WORKS
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { step: '1', text: 'Create Bill' },
              { step: '2', text: 'Share link' },
              { step: '3', text: 'Select chain' },
              { step: '4', text: 'Send USDC' },
            ].map(item => (
              <div key={item.step} style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}>
                <span style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: colors.badgeBg,
                  color: colors.badgeText,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>{item.step}</span>
                <span style={{ fontSize: 15, color: colors.bodyText }}>{item.text}</span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 28 }}>
            Built on Arc · USDC · CCTP V2
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src="/hero.svg"
            alt="Sabi bill splitting"
            style={{ width: '100%' }}
          />
        </div>
      </main>
    </div>
  );
};

export default Home;
