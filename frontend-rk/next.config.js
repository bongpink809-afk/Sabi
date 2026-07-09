const { i18n } = require('./next-i18next.config')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  i18n,
  // Cho phép truy cập từ tunnel (ngrok, localtunnel) khi test trên mobile
  // Next.js 16 chặn cross-origin request mặc định — cần khai báo domain tunnel tại đây
  allowedDevOrigins: [
    '*.loca.lt',          // localtunnel
    '*.ngrok-free.app',   // ngrok free
    '*.ngrok.io',         // ngrok legacy
    '*.ngrok-free.dev',   // ngrok
  ],
};

module.exports = nextConfig;
