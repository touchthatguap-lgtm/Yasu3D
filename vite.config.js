import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev-only endpoint so the in-game editor can persist tuned values to disk.
// POST /__save-overrides  { rifle: { viewmodel: {...} }, ... }  -> src/weapon-overrides.json
function devSavePlugin() {
  return {
    name: "yasu-dev-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-overrides", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const incoming = JSON.parse(body);
            const file = path.resolve(__dirname, "src/weapon-overrides.json");

            // Merge per-weapon so saving one gun doesn't wipe the others.
            let existing = {};
            try {
              existing = JSON.parse(fs.readFileSync(file, "utf8")) || {};
            } catch {
              existing = {};
            }
            for (const key in incoming) {
              existing[key] = { ...(existing[key] || {}), ...incoming[key] };
            }

            fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [devSavePlugin()],
});
