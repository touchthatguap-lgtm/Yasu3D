import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { loadModel } from "./assets.js";
import { setArenaDecor } from "./world.js";

// Dev map builder: orbit the scene, add models from a palette (or import files),
// move/rotate/scale them with gizmos, and save/load maps to disk.
export class MapEditor {
  constructor(scene, camera, renderer, world, { onExit }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.world = world;
    this.onExit = onExit;
    this.active = false;

    this.objects = []; // { model: url, name, node }
    this.selected = null;
    this.mapName = "custom";
    // Filename of the currently-loaded map (null for a brand-new map). Used so
    // that renaming + saving updates the map in place instead of duplicating it.
    this.loadedMapName = null;
    this.models = []; // available model files from the server

    // Orbit camera (disabled until the editor opens).
    this.orbit = new OrbitControls(camera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.enabled = false;

    // Transform gizmo.
    this.tc = new TransformControls(camera, renderer.domElement);
    this.tc.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = this.active && !e.value;
    });
    const helper = this.tc.getHelper ? this.tc.getHelper() : this.tc;
    this.helper = helper;

    this.raycaster = new THREE.Raycaster();

    this._injectStyles();
    this._buildPanel();
    this._bindCanvas();
    this._bindKeys();
  }

  // -------------------------------------------------------------- open / close
  async open() {
    this.active = true;
    document.body.classList.add("map-editing");
    this.panel.style.display = "flex";
    this.scene.add(this.helper);
    setArenaDecor(this.world, false); // build on a clean baseplate

    this.camera.position.set(0, 30, 45);
    this.orbit.target.set(0, 2, 0);
    this.orbit.enabled = true;
    this.orbit.update();

    await this._loadModelList();
    this._renderMaps();
  }

  close() {
    this.active = false;
    document.body.classList.remove("map-editing");
    this.panel.style.display = "none";
    this.orbit.enabled = false;
    this.clearObjects(); // saved to disk; the game loads a fresh copy
    this.scene.remove(this.helper);
    setArenaDecor(this.world, true); // restore the default arena for the menu
    if (this.onExit) this.onExit();
  }

  // Start a fresh, empty map with a new name.
  newMap() {
    this.clearObjects();
    this.loadedMapName = null; // a fresh map isn't tied to any existing file
    this.mapName = "untitled";
    const input = this.panel.querySelector("#me-name");
    input.value = this.mapName;
    input.focus();
    input.select();
    this._status("🆕 New map — add structures, name it, then Save");
  }

  clearObjects() {
    this._deselect();
    for (const o of this.objects) {
      this.scene.remove(o.node);
      o.node.traverse((n) => {
        if (n.isMesh) {
          n.geometry?.dispose();
          if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
          else n.material?.dispose();
        }
      });
    }
    this.objects = [];
    this._renderOutliner();
  }

  // -------------------------------------------------------------- objects
  async addModel(url, name) {
    let node;
    try {
      node = (await loadModel(url)).scene;
    } catch (e) {
      this._status("❌ load failed: " + e.message, true);
      return;
    }
    // Drop it at the orbit target so it appears in view.
    node.position.copy(this.orbit.target);
    this.scene.add(node);
    const entry = {
      model: url,
      name: name || url.split("/").pop(),
      node,
      color: null,
      _origColors: this._recordColors(node),
    };
    this.objects.push(entry);
    this._select(entry);
    this._renderOutliner();
  }

  // Place a spawn-point marker (green ring + facing arrow). Saved as a spawn,
  // not a structure — the game spawns players here.
  addSpawn() {
    const node = this._makeSpawnMarker();
    node.position.copy(this.orbit.target);
    node.position.y = 0;
    this.scene.add(node);
    const entry = { isSpawn: true, name: "Spawn", node, color: null, _origColors: [] };
    this.objects.push(entry);
    this._select(entry);
    this._renderOutliner();
  }

  _makeSpawnMarker() {
    const g = new THREE.Group();
    const green = 0x39d353;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.08, 22),
      new THREE.MeshBasicMaterial({ color: green, transparent: true, opacity: 0.55 })
    );
    ring.position.y = 0.04;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8),
      new THREE.MeshBasicMaterial({ color: green })
    );
    pole.position.y = 0.8;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.6, 12),
      new THREE.MeshBasicMaterial({ color: green })
    );
    arrow.rotation.x = -Math.PI / 2; // point toward -Z (player's forward)
    arrow.position.set(0, 0.4, -0.7);
    g.add(ring, pole, arrow);
    g.userData.isSpawnMarker = true;
    return g;
  }

  // Snapshot each material's original color so a recolor can be reverted.
  _recordColors(node) {
    const arr = [];
    node.traverse((n) => {
      if (!n.isMesh) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (m && m.color) arr.push({ mat: m, hex: "#" + m.color.getHexString() });
      }
    });
    return arr;
  }

  applyColor(entry, hex) {
    for (const e of entry._origColors) e.mat.color.set(hex);
    entry.color = hex;
  }

  resetColor(entry) {
    for (const e of entry._origColors) e.mat.color.set(e.hex);
    entry.color = null;
  }

  deleteSelected() {
    if (!this.selected) return;
    const entry = this.selected;
    this._deselect();
    this.scene.remove(entry.node);
    this.objects = this.objects.filter((o) => o !== entry);
    this._renderOutliner();
  }

  _select(entry) {
    this.selected = entry;
    this.tc.attach(entry.node);
    const ci = this.panel.querySelector("#me-color");
    if (ci) ci.value = entry.color || entry._origColors[0]?.hex || "#cccccc";
    this._renderOutliner();
  }
  _deselect() {
    this.selected = null;
    this.tc.detach();
  }

  setMode(mode) {
    this.tc.setMode(mode);
    this.panel.querySelectorAll(".me-mode button").forEach((b) =>
      b.classList.toggle("on", b.dataset.mode === mode)
    );
  }

  // -------------------------------------------------------------- per-frame
  update() {
    if (!this.active) return;
    this.orbit.update();
  }

  // -------------------------------------------------------------- save / load
  async save() {
    const name = (this.panel.querySelector("#me-name").value || "custom")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const objects = [];
    const spawns = [];
    for (const o of this.objects) {
      if (o.isSpawn) {
        spawns.push({
          x: +o.node.position.x.toFixed(3),
          y: +o.node.position.y.toFixed(3),
          z: +o.node.position.z.toFixed(3),
          yaw: +o.node.rotation.y.toFixed(4),
        });
      } else {
        objects.push({
          model: o.model,
          position: o.node.position.toArray().map((n) => +n.toFixed(3)),
          rotation: [o.node.rotation.x, o.node.rotation.y, o.node.rotation.z].map((n) => +n.toFixed(4)),
          scale: o.node.scale.toArray().map((n) => +n.toFixed(3)),
          color: o.color || null,
        });
      }
    }
    const data = { name, objects, spawns };
    try {
      const res = await fetch("/__save-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const j = await res.json();
      if (j.ok) {
        // If we loaded an existing map and the name changed, this is a rename:
        // remove the old file so we update in place instead of leaving a copy.
        if (this.loadedMapName && this.loadedMapName !== j.name) {
          await this._deleteMapFile(this.loadedMapName);
        }
        this.loadedMapName = j.name;
        this._status(`✅ Saved "${j.name}" (${objects.length} objects, ${spawns.length} spawns)`);
      } else {
        this._status("❌ " + j.error, true);
      }
      this._renderMaps();
    } catch (e) {
      this._status("❌ save failed (dev only): " + e.message, true);
    }
  }

  async _deleteMapFile(name) {
    try {
      await fetch("/__delete-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (e) {
      console.warn("[Yasu3D] failed to remove old map file", name, e.message);
    }
  }

  async loadMap(name) {
    try {
      const res = await fetch(`/maps/${name}.json`);
      const data = await res.json();
      this.clearObjects();
      this.loadedMapName = name; // remember the file we loaded, for rename-on-save
      this.mapName = data.name || name;
      this.panel.querySelector("#me-name").value = this.mapName;
      for (const o of data.objects || []) {
        let node;
        try {
          node = (await loadModel(o.model)).scene;
        } catch {
          continue;
        }
        node.position.fromArray(o.position || [0, 0, 0]);
        node.rotation.set(...(o.rotation || [0, 0, 0]));
        node.scale.fromArray(o.scale || [1, 1, 1]);
        this.scene.add(node);
        const entry = {
          model: o.model,
          name: o.model.split("/").pop(),
          node,
          color: null,
          _origColors: this._recordColors(node),
        };
        if (o.color) this.applyColor(entry, o.color);
        this.objects.push(entry);
      }
      for (const sp of data.spawns || []) {
        const node = this._makeSpawnMarker();
        node.position.set(sp.x || 0, sp.y || 0, sp.z || 0);
        node.rotation.y = sp.yaw || 0;
        this.scene.add(node);
        this.objects.push({ isSpawn: true, name: "Spawn", node, color: null, _origColors: [] });
      }
      this._renderOutliner();
      this._status(`📂 Loaded "${name}"`);
    } catch (e) {
      this._status("❌ load failed: " + e.message, true);
    }
  }

  async _loadModelList() {
    try {
      const res = await fetch("/__list-models");
      const j = await res.json();
      this.models = j.models || [];
    } catch {
      this.models = [];
    }
    this._renderPalette();
  }

  async _uploadFile(file) {
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    try {
      const res = await fetch("/__upload-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, base64 }),
      });
      const j = await res.json();
      if (j.ok) {
        this._status(`⬆ Imported ${file.name}`);
        await this._loadModelList();
        this.addModel(j.url, file.name);
      } else {
        this._status("❌ " + j.error, true);
      }
    } catch (e) {
      this._status("❌ upload failed: " + e.message, true);
    }
  }

  // -------------------------------------------------------------- UI
  _buildPanel() {
    const p = document.createElement("div");
    p.id = "map-editor";
    p.innerHTML = `
      <div class="me-head">
        <span>🗺 Map Builder</span>
        <button class="me-exit" title="Exit to menu">✕ Exit</button>
      </div>
      <div class="me-row">
        <input id="me-name" value="${this.mapName}" placeholder="map name" />
      </div>
      <div class="me-actions">
        <button class="me-btn me-newmap">🆕 New</button>
        <button class="me-btn me-save">💾 Save</button>
        <button class="me-btn me-clear">🗑 Clear</button>
      </div>

      <div class="me-h">Transform <span class="me-dim">(W move · E rotate · R scale)</span></div>
      <div class="me-mode">
        <button data-mode="translate" class="on">Move</button>
        <button data-mode="rotate">Rotate</button>
        <button data-mode="scale">Scale</button>
        <button class="me-del">Delete</button>
      </div>

      <div class="me-h">Color <span class="me-dim">(selected object)</span></div>
      <div class="me-color">
        <input type="color" id="me-color" value="#cccccc" />
        <button class="me-btn me-color-reset">Reset</button>
      </div>

      <div class="me-h">Add structure</div>
      <div class="me-import">
        <label class="me-btn">⬆ Import file<input type="file" accept=".glb,.gltf,.obj,.fbx" hidden /></label>
        <button class="me-btn me-add-spawn">⚑ Add Spawn</button>
      </div>
      <div class="me-palette"></div>

      <div class="me-h">Objects (<span id="me-count">0</span>)</div>
      <div class="me-outliner"></div>

      <div class="me-h">Saved maps</div>
      <div class="me-maps"></div>

      <div class="me-status"></div>
    `;
    document.body.appendChild(p);
    this.panel = p;

    p.querySelector(".me-exit").addEventListener("click", () => this.close());
    p.querySelector(".me-newmap").addEventListener("click", () => this.newMap());
    p.querySelector(".me-save").addEventListener("click", () => this.save());
    p.querySelector(".me-clear").addEventListener("click", () => this.clearObjects());
    p.querySelector(".me-del").addEventListener("click", () => this.deleteSelected());
    p.querySelectorAll(".me-mode button[data-mode]").forEach((b) =>
      b.addEventListener("click", () => this.setMode(b.dataset.mode))
    );
    const colorInput = p.querySelector("#me-color");
    colorInput.addEventListener("input", () => {
      if (this.selected) this.applyColor(this.selected, colorInput.value);
    });
    p.querySelector(".me-color-reset").addEventListener("click", () => {
      if (!this.selected) return;
      this.resetColor(this.selected);
      colorInput.value = this.selected._origColors[0]?.hex || "#cccccc";
    });
    p.querySelector('input[type="file"]').addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) this._uploadFile(f);
      e.target.value = "";
    });
    p.querySelector(".me-add-spawn").addEventListener("click", () => this.addSpawn());
  }

  _renderPalette() {
    const box = this.panel.querySelector(".me-palette");
    if (!this.models.length) {
      box.innerHTML = `<div class="me-dim">No models found in public/models</div>`;
      return;
    }
    box.innerHTML = this.models
      .map(
        (m, i) =>
          `<button class="me-pal" data-i="${i}" title="${m.url}">${escapeHtml(m.name)}<span>${escapeHtml(m.folder)}</span></button>`
      )
      .join("");
    box.querySelectorAll(".me-pal").forEach((b) => {
      b.addEventListener("click", () => {
        const m = this.models[+b.dataset.i];
        this.addModel(m.url, m.name);
      });
    });
  }

  _renderOutliner() {
    const box = this.panel.querySelector(".me-outliner");
    this.panel.querySelector("#me-count").textContent = String(this.objects.length);
    box.innerHTML = this.objects
      .map(
        (o, i) =>
          `<div class="me-item ${o === this.selected ? "sel" : ""}" data-i="${i}">${o.isSpawn ? "⚑ " : ""}${escapeHtml(o.name)}</div>`
      )
      .join("");
    box.querySelectorAll(".me-item").forEach((el) => {
      el.addEventListener("click", () => this._select(this.objects[+el.dataset.i]));
    });
  }

  async _renderMaps() {
    const box = this.panel.querySelector(".me-maps");
    let maps = [];
    try {
      const res = await fetch(`/maps/index.json?t=${Date.now()}`);
      maps = (await res.json()) || [];
    } catch {}
    box.innerHTML = maps.length
      ? maps
          .map(
            (m) => `<div class="me-map-row">
              <button class="me-map" data-n="${escapeHtml(m)}">${escapeHtml(m)}</button>
              <button class="me-map-del" data-n="${escapeHtml(m)}" title="Delete map">✕</button>
            </div>`
          )
          .join("")
      : `<div class="me-dim">none yet</div>`;
    box.querySelectorAll(".me-map").forEach((b) =>
      b.addEventListener("click", () => this.loadMap(b.dataset.n))
    );
    box.querySelectorAll(".me-map-del").forEach((b) =>
      b.addEventListener("click", () => this.deleteMap(b.dataset.n))
    );
  }

  // Delete a saved map file (with confirmation).
  async deleteMap(name) {
    if (!window.confirm(`Delete map "${name}"? This can't be undone.`)) return;
    await this._deleteMapFile(name);
    if (this.loadedMapName === name) this.loadedMapName = null;
    this._status(`🗑 Deleted "${name}"`);
    this._renderMaps();
  }

  _status(msg, err = false) {
    const el = this.panel.querySelector(".me-status");
    el.textContent = msg;
    el.className = "me-status " + (err ? "err" : "ok");
  }

  // -------------------------------------------------------------- input
  _bindCanvas() {
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (!this.active || e.button !== 0) return;
      if (this.tc.dragging || this.tc.axis) return; // interacting with the gizmo
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const meshes = [];
      this.objects.forEach((o) => o.node.traverse((n) => n.isMesh && meshes.push(n)));
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      if (hit) {
        // Walk up to the object's root node.
        let root = hit.object;
        const entry = this.objects.find((o) => {
          let n = root;
          while (n) {
            if (n === o.node) return true;
            n = n.parent;
          }
          return false;
        });
        if (entry) this._select(entry);
      }
    });
  }

  _bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.code === "KeyW") this.setMode("translate");
      else if (e.code === "KeyE") this.setMode("rotate");
      else if (e.code === "KeyR") this.setMode("scale");
      else if (e.code === "Delete" || e.code === "Backspace") this.deleteSelected();
      else if (e.code === "Escape") this.close();
    });
  }

  _injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      body.map-editing #app { cursor: default; }
      #map-editor {
        position: fixed; top: 0; left: 0; height: 100vh; width: 280px; z-index: 40;
        display: none; flex-direction: column; gap: 6px; overflow-y: auto;
        background: rgba(13,17,23,0.96); border-right: 1px solid #2a3a52;
        color: #e6edf3; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: 12px;
        padding: 14px;
      }
      #map-editor .me-head { display:flex; justify-content:space-between; align-items:center; font-weight:800; font-size:15px; color:#7ee787; }
      #map-editor .me-exit { background:none; border:none; color:#ff7b72; cursor:pointer; font-family:inherit; font-size:12px; }
      #map-editor .me-row input, #map-editor #me-name {
        width:100%; background:#0d1117; color:#e6edf3; border:1px solid #2a3a52; border-radius:6px; padding:8px; font-family:inherit; }
      #map-editor .me-h { color:#7aa7ff; font-size:11px; letter-spacing:1px; margin-top:10px; border-bottom:1px solid #1f2a3a; padding-bottom:3px; }
      #map-editor .me-dim { color:#6f7d8c; font-weight:400; }
      #map-editor .me-actions, #map-editor .me-mode, #map-editor .me-import { display:flex; gap:6px; flex-wrap:wrap; }
      #map-editor .me-btn, #map-editor .me-mode button {
        flex:1; background:#21262d; color:#e6edf3; border:1px solid #2a3a52; border-radius:6px; padding:8px;
        cursor:pointer; font-family:inherit; font-weight:700; text-align:center; }
      #map-editor .me-btn:hover, #map-editor .me-mode button:hover { border-color:#4c9aff; }
      #map-editor .me-mode button.on { background:#1f6feb; border-color:#1f6feb; }
      #map-editor .me-del { background:#3d1418 !important; border-color:#b3322c !important; color:#ff7b72; }
      #map-editor .me-save { background:#16301f; border-color:#2ea043; }
      #map-editor .me-import label { cursor:pointer; margin:0; }
      #map-editor .me-color { display:flex; gap:6px; align-items:center; }
      #map-editor .me-color input[type=color] { width:48px; height:34px; padding:0; border:1px solid #2a3a52; border-radius:6px; background:#0d1117; cursor:pointer; }
      #map-editor .me-color .me-btn { flex:1; }
      #map-editor .me-palette { display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto; }
      #map-editor .me-pal { display:flex; justify-content:space-between; gap:8px; background:#0d1117; color:#e6edf3;
        border:1px solid #2a3a52; border-radius:6px; padding:7px 9px; cursor:pointer; font-family:inherit; text-align:left; }
      #map-editor .me-pal:hover { border-color:#4c9aff; }
      #map-editor .me-pal span { color:#6f7d8c; font-size:10px; }
      #map-editor .me-outliner { display:flex; flex-direction:column; gap:3px; max-height:150px; overflow-y:auto; }
      #map-editor .me-item { background:#0d1117; border:1px solid #1f2a3a; border-radius:5px; padding:6px 9px; cursor:pointer; }
      #map-editor .me-item:hover { border-color:#4c9aff; }
      #map-editor .me-item.sel { background:#11233f; border-color:#4c9aff; }
      #map-editor .me-maps { display:flex; flex-direction:column; gap:4px; }
      #map-editor .me-map-row { display:flex; gap:4px; }
      #map-editor .me-map { flex:1; background:#0d1117; color:#cfe0ff; border:1px solid #2a3a52; border-radius:5px; padding:6px 10px; cursor:pointer; font-family:inherit; text-align:left; }
      #map-editor .me-map:hover { border-color:#4c9aff; }
      #map-editor .me-map-del { background:#3d1418; color:#ff7b72; border:1px solid #b3322c; border-radius:5px; padding:6px 9px; cursor:pointer; font-family:inherit; font-weight:700; }
      #map-editor .me-map-del:hover { background:#571b20; }
      #map-editor .me-status { margin-top:10px; min-height:16px; font-size:11px; }
      #map-editor .me-status.ok { color:#7ee787; }
      #map-editor .me-status.err { color:#ff7b72; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
