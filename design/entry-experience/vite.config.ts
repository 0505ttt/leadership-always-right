import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base: '/',
  server: {
    host: '0.0.0.0',
    fs: { allow: [here, path.resolve(here, '../..')] },
  },
  build: { target: 'es2022' },
});
