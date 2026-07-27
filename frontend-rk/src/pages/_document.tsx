import Document, { Html, Head, Main, NextScript, DocumentContext, DocumentInitialProps } from 'next/document'

// _document.tsx phải có meta viewport với width=device-width,initial-scale=1
// — thiếu dòng này browser mobile "giả lập" viewport rộng ~980px, khiến
// mọi media query max-width không bao giờ trigger trên điện thoại thật.
export default function MyDocument({ locale }: DocumentInitialProps & { locale: string }) {
  return (
    <Html lang={locale}>
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

// Lấy locale thật của request (en/vi) để đặt đúng lang trên thẻ <html> —
// trước đây hardcode "vi", sai với trang đang hiển thị tiếng Anh (defaultLocale).
MyDocument.getInitialProps = async (ctx: DocumentContext): Promise<DocumentInitialProps & { locale: string }> => {
  const initialProps = await Document.getInitialProps(ctx)
  return { ...initialProps, locale: ctx.locale ?? 'en' }
}
