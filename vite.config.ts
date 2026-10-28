import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { AGENT_PAGES_PORT, agentPagesPlugin } from './server/api.ts';
import { excalidrawAssetsPlugin } from './server/excalidraw-assets.ts';

export default defineConfig({
  plugins: [react(), agentPagesPlugin(), excalidrawAssetsPlugin()],
  server: { host: '127.0.0.1', port: AGENT_PAGES_PORT, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/src/renderers')) return 'three-renderer';
          if (id.includes('node_modules/three')) return 'three-core';
        },
      },
    },
  },
});
