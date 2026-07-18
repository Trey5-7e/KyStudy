import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
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
