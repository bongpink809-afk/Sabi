const { i18n } = require('./next-i18next.config')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  i18n,
  // Fix i18n mất trên Vercel: next-i18next đọc public/locales/*.json qua fs tại
  // runtime (không phải import tĩnh), nên Next.js không tự trace các file này vào
  // serverless function bundle — production thiếu file, t() trả về key thô thay vì
  // text dịch. Ép include thủ công để mọi route đều có sẵn file locale khi chạy.
  outputFileTracingIncludes: {
    '/**': ['./public/locales/**/*'],
  },
  // Cho phép truy cập từ tunnel (ngrok, localtunnel) khi test trên mobile
  // Next.js 16 chặn cross-origin request mặc định — cần khai báo domain tunnel tại đây
  allowedDevOrigins: [
    '*.loca.lt',          // localtunnel
    '*.ngrok-free.app',   // ngrok free
    '*.ngrok.io',         // ngrok legacy
    '*.ngrok-free.dev',   // ngrok
  ],
  // Fix: MetaMask SDK kéo React Native dependency vào môi trường web
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    }
    return config
  },
};

module.exports = nextConfig