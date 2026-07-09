import { Html, Head, Main, NextScript } from 'next/document'

// _document.tsx phải có meta viewport với width=device-width,initial-scale=1
// — thiếu dòng này browser mobile "giả lập" viewport rộng ~980px, khiến
// mọi media query max-width không bao giờ trigger trên điện thoại thật.
export default function Document() {
  return (
    <Html lang="vi">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
