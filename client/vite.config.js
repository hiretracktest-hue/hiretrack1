import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the React app runs on port 5173 and the Express API
// on port 4000. This proxy forwards every /api call to Express so the
// browser still sees one origin and the login cookie works normally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
