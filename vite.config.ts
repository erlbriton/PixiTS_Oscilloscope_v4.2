import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    base: '/PixiTS_Oscilloscope_v4.2/',
    build: {
      chunkSizeWarningLimit: 1000, // Увеличиваем лимит предупреждений до 1 МБ
      rollupOptions: {
        // Указываем две точки входа: главное приложение и просмотрщик осциллограмм
        input: {
          main: 'index.html',
          viewer: 'rec-viewer.html',
        },
        output: {
          manualChunks: {
            // Выносим PixiJS в отдельный чанк (самая тяжелая библиотека)
            'pixi-vendor': ['pixi.js'],
            // Выносим ExcelJS в отдельный чанк (тяжелая библиотека для экспорта)
            'excel-vendor': ['exceljs']
            // '@google/genai' удален, так как чанк получился пустым.
            // Если библиотека понадобится позже, она автоматически попадет в основной бандл
            // или можно будет вернуть её сюда при необходимости.
          }
        }
      }
    },
    plugins: [],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});