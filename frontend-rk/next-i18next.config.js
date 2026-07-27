module.exports = {
  i18n: {
    defaultLocale: 'en',
    // TODO: bổ sung 'zh', 'ko', 'ja' sau khi có bản dịch
    locales: ['vi', 'en'],
    // Tắt auto-detect theo Accept-Language của trình duyệt — không có dòng này,
    // Next.js tự redirect "/" sang "/vi" nếu trình duyệt/OS cài tiếng Việt, bất kể
    // defaultLocale là gì (defaultLocale chỉ áp dụng khi KHÔNG detect được locale nào khớp).
    localeDetection: false,
  },
}
