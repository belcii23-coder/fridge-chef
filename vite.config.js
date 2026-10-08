import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// During `npm run dev`, serve everything in /api locally so you don't need any extra tools.
// In production (Vercel), the files in /api are deployed as serverless functions instead.
function localApi(env) {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res, next) => {
        // req.url is "/recipes" or "/ingredients" here (the /api part is already removed)
        const name = (req.url || "").split("?")[0].replace(/^\/+/, "");
        if (!/^[a-z][a-z-]*$/i.test(name)) return next();

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
          const mod = await server.ssrLoadModule(`/api/${name}.js`);
          await mod.default(req, res);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Local API crashed. Check the terminal." });
        }
      });
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
          // Never serve the app shell for API calls; recipes need a live connection.
          navigateFallbackDenylist: [/^\/api\//]
        }
      })
    ]
  };
});
