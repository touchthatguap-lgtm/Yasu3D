import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, "public");
const MODELS_DIR = path.join(PUBLIC, "models");
const MAPS_DIR = path.join(PUBLIC, "maps");
const STRUCT_DIR = path.join(MODELS_DIR, "structures");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}
function sendJson(res, obj, code = 200) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}
function walk(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(fp));
    else out.push(fp);
  }
  return out;
}

// Writes public/maps/index.json — a static manifest of available maps. This is
// what the deployed (production) site reads to list maps, since the dev-only
// endpoints below don't exist there. Kept in sync on every save/delete and
// regenerated at dev-server start + production build.
function writeMapIndex() {
  if (!fs.existsSync(MAPS_DIR)) return;
  const maps = fs
    .readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => f.replace(/\.json$/, ""));
  fs.writeFileSync(path.join(MAPS_DIR, "index.json"), JSON.stringify(maps, null, 2) + "\n");
}

// Regenerates the maps manifest at dev-server start and on production build, so
// it always matches the .json files actually on disk. Runs in both modes.
function mapIndexPlugin() {
  return {
    name: "yasu-map-index",
    buildStart() {
      writeMapIndex();
    },
  };
}

// Dev-only endpoints powering the in-game editors (gun viewmodel + map builder).
function devPlugin() {
  return {
    name: "yasu-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        try {
          // --- Weapon viewmodel overrides (merge per-weapon) ---
          if (url === "/__save-overrides" && req.method === "POST") {
            const incoming = JSON.parse(await readBody(req));
            const file = path.resolve(__dirname, "src/weapon-overrides.json");
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
            return sendJson(res, { ok: true });
          }

          // --- List available model files ---
          if (url === "/__list-models" && req.method === "GET") {
            const files = walk(MODELS_DIR).filter((f) => /\.(glb|gltf|obj|fbx)$/i.test(f));
            const models = files.map((f) => {
              const rel = path.relative(PUBLIC, f).split(path.sep).join("/");
              const folder = path.dirname(rel).replace(/^models\/?/, "");
              return { url: "/" + rel, name: path.basename(f), folder };
            });
            return sendJson(res, { ok: true, models });
          }

          // --- Save a map ---
          if (url === "/__save-map" && req.method === "POST") {
            const data = JSON.parse(await readBody(req));
            const name = String(data.name || "untitled").replace(/[^a-zA-Z0-9_-]/g, "_");
            if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });
            fs.writeFileSync(path.join(MAPS_DIR, name + ".json"), JSON.stringify(data, null, 2) + "\n");
            writeMapIndex();
            return sendJson(res, { ok: true, name });
          }

          // --- Delete a map (used to rename a map in place) ---
          if (url === "/__delete-map" && req.method === "POST") {
            const data = JSON.parse(await readBody(req));
            const name = String(data.name || "").replace(/[^a-zA-Z0-9_-]/g, "_");
            const fp = path.join(MAPS_DIR, name + ".json");
            if (name && fs.existsSync(fp)) fs.unlinkSync(fp);
            writeMapIndex();
            return sendJson(res, { ok: true, name });
          }

          // --- Upload a model file (base64) into public/models/structures ---
          if (url === "/__upload-model" && req.method === "POST") {
            const data = JSON.parse(await readBody(req));
            const name = String(data.name || "model.glb").replace(/[^a-zA-Z0-9_.-]/g, "_");
            if (!fs.existsSync(STRUCT_DIR)) fs.mkdirSync(STRUCT_DIR, { recursive: true });
            fs.writeFileSync(path.join(STRUCT_DIR, name), Buffer.from(data.base64, "base64"));
            return sendJson(res, { ok: true, url: "/models/structures/" + name });
          }

          next();
        } catch (e) {
          sendJson(res, { ok: false, error: e.message }, 400);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [mapIndexPlugin(), devPlugin()],
});
