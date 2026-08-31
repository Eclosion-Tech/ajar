import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { detectApi } from './detect-middleware';

export default defineConfig({
  plugins: [react(), detectApi()],
});
