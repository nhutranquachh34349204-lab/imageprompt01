import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' makes the built site work from any GitHub Pages subpath.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // Allow the Arena.ai live-preview host (dynamic per sandbox) to reach the dev server.
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
