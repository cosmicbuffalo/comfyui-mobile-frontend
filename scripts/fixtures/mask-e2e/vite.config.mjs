import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Lives inside the repo rather than being generated into a temp directory, so
// `vite` and the plugins resolve against the project's own node_modules.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(repo, 'src') } },
  server: { port: Number(process.env.MASK_E2E_PORT ?? 5196), strictPort: true },
});
