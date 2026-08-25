import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  resolve: {
    // assistant-ui is installed through pnpm's peer graph; dedupe React so
    // its primitives and KyStudy render against the same hook dispatcher.
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: tauriDevHost || false,
    port: 1420,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          host: tauriDevHost,
          port: 1421,
          protocol: "ws",
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
