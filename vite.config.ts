import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4444",
      "/variants": "http://localhost:4444",
      "/__feedback": "http://localhost:4444",
      "/__reload": {
        target: "http://localhost:4444",
        // SSE needs these headers preserved
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache"
              proxyRes.headers["connection"] = "keep-alive"
            }
          })
        },
      },
    },
  },
})
