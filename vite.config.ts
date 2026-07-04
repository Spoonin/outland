import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this repo at /outland/ — only `vite build` needs the subpath; `vite dev`
// and vitest (both resolve as command 'serve') stay at root so local URLs don't change.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/outland/' : '/',
  plugins: [
    VitePWA({
      // NEVER auto-activate a new version mid-session (registerType 'autoUpdate' would swap
      // assets under a running game). We register by hand (injectRegister: null) and only call
      // updateSW() from colony-app.ts's "Новая партия" handler — see src/ui/pwa.ts.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Outland',
        short_name: 'Outland',
        description: 'Outland — игра-аргумент о невозможности автономной марсианской колонии',
        theme_color: '#0e0e12',
        background_color: '#0e0e12',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
  // Engine tests are pure (node env); UI/Lit component tests will switch to jsdom later.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
