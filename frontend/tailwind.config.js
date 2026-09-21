/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Skala font dinaikkan supaya teks bawaan (text-sm) = 16px, karena pengguna
       * kasir banyak yang berusia 35+ dan membaca di layar HP.
       * text-xs 14px, text-sm 16px, text-base 17px.
       */
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['1rem', { lineHeight: '1.5rem' }],
        base: ['1.0625rem', { lineHeight: '1.625rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.25rem' }],
        '3xl': ['2rem', { lineHeight: '2.5rem' }],
      },
      minHeight: {
        sentuh: '44px',
      },
      minWidth: {
        sentuh: '44px',
      },
      /**
       * Sidebar hanya untuk layar desktop sungguhan: lebar >=1280px DAN penunjuk presisi
       * (mouse/trackpad). Cek `pointer: fine` itu wajib, bukan hiasan: lebar saja tidak bisa
       * memisahkan iPad Pro 12,9" landscape (1366px) dari laptop 1366px, sedangkan pemilik
       * toko minta sidebar hilang di iPad Pro. iPad melaporkan pointer kasar (coarse),
       * jadi syarat ini menyembunyikan sidebar di tablet dan menampilkannya di laptop.
       * JANGAN disederhanakan jadi breakpoint lebar saja.
       */
      screens: {
        desktop: { raw: '(min-width: 1280px) and (pointer: fine)' },
      },
    },
  },
  plugins: [],
};
