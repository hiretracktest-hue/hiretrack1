import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the React app runs on port 5173 and the Express API
// on port 4000. This proxy forwards every /api call to Express so the
// browser still sees one origin and the login cookie works normally.
//
// A cold `npm run dev` prints a few of these into the terminal:
//
//   [vite] http proxy error: /api/auth/me
//   AggregateError [ECONNREFUSED]
//
// They are expected and harmless. Vite is serving in under 200ms while
// Express is still connecting to Supabase, so the first couple of calls
// find nothing on port 4000. The message is Vite's own and cannot be
// replaced from here - adding a handler prints a second line above the
// same stack rather than instead of it.
//
// What matters is that the app does not act on them: AuthProvider
// retries these two calls while the API is starting, instead of reading
// "no answer" as "not signed in". See client/src/AuthContext.jsx.
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
