import { Html, Head, Main, NextScript } from 'next/document'

// _document.tsx phải có meta viewport với width=device-width,initial-scale=1
// — thiếu dòng này browser mobile "giả lập" viewport rộng ~980px, khiến
// mọi media query max-width không bao giờ trigger trên điện thoại thật.
export default function Document() {
  return (
    <Html lang="vi">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#081426" />
        <meta name="application-name" content="Sabi" />
        <meta name="apple-mobile-web-app-title" content="Sabi" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
