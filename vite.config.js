import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function localApi(env) {
  function mount(server, routePath, modulePath) {
    server.middlewares.use(routePath, async (req, res) => {
      Object.assign(process.env, env);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      req.body = Buffer.concat(chunks).toString() || "{}";
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (obj) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      try {
        const mod = await server.ssrLoadModule(modulePath);
        await mod.default(req, res);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Local API crashed. Check the terminal." });
      }
    });
  }

  return {
    name: "local-api",
    configureServer(server) {
      mount(server, "/api/recipes", "/api/recipes.js");
      mount(server, "/api/scan", "/api/scan.js");
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      localApi(env),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg", "icon-192.png"],
        manifest: {
          name: "Fridge Chef",
          short_name: "Fridge Chef",
          description: "Tell it what's in your fridge. Get budget-friendly recipes you can cook right now.",
          theme_color: "#e8590c",
          background_color: "#fff8f0",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
          ]
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/upload\.wikimedia\.org\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "dish-photos",
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] }
              }
            }
          ]
        }
      })
    ]
  };
});
