import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ✅ Configuração compatível com ESM
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  esbuild: {
    target: "esnext"
  }
});
