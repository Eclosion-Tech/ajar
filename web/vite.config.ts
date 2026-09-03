import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { detectApi } from './detect-middleware';

// Override with AJAR_DEMO_UVTT when the fixture lives outside this repo.
const demoUvttPath = process.env.AJAR_DEMO_UVTT
  ? resolve(process.env.AJAR_DEMO_UVTT)
  : fileURLToPath(new URL('../samples/pig-and-whistle-tavern.uvtt', import.meta.url));

const demoFixture = () => ({
  name: 'ajar-demo-fixture',
  configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/demo/pig-and-whistle.uvtt') return next();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(demoUvttPath).pipe(res as never);
    });
  },
});

export default defineConfig({
  plugins: [react(), detectApi(), demoFixture()],
});
