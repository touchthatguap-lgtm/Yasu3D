// In-game viewmodel editor (dev only). Toggle with the ` (backtick) key.
// Live-edits the weapon viewmodel via sliders + viewport drag/scroll, and can
// persist values to src/weapon-overrides.json through the Vite dev plugin.

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export class DevEditor {
  // getWeapon() -> { weapon, key } returns the currently active weapon to edit.
  constructor(getWeapon, camera, canvas) {
    this.getWeapon = getWeapon;
    this.camera = camera;
    this.canvas = canvas;
    this.active = false;

    const { weapon, key } = getWeapon();
    this.weapon = weapon;
    this.weaponKey = key;

    // Working copy of the viewmodel config.
    this.vm = structuredClone(weapon.cfg.viewmodel);
    this.normalizeVm();

    // What viewport drag/scroll manipulates: "gun" or "muzzle".
    this.dragTarget = "gun";
    this.dragging = false;

    this.inputs = {}; // id -> { range, number } for syncing
    this._injectStyles();
    this._buildPanel();
    this._bindGlobalKeys();
    this._bindViewport();
  }

  normalizeVm() {
    const v = this.vm;
    v.length ??= 0.5;
    v.position ??= [0.28, -0.24, -0.45];
    v.extraRotation ??= [0, 0, 0];
    v.muzzleOffset ??= [0, 0, 0];
    v.flip ??= false;
  }

  // ----- Panel UI -----
  _buildPanel() {
    const panel = document.createElement("div");
    panel.id = "dev-editor";
    panel.innerHTML = `
      <div class="de-head">
        <span>🛠 Viewmodel Editor</span>
        <button class="de-x" title="Close (\`)">✕</button>
      </div>
      <div class="de-hint">Drag in the world to move &middot; scroll to resize</div>
      <div class="de-row de-seg">
        <label>Drag affects</label>
        <div class="de-seg-btns">
          <button data-target="gun" class="on">Gun</button>
          <button data-target="muzzle">Muzzle</button>
        </div>
      </div>
      <div class="de-fields"></div>
      <div class="de-actions">
        <button class="de-save">💾 Save</button>
        <button class="de-copy">⧉ Copy JSON</button>
      </div>
      <div class="de-status"></div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;

    const fields = panel.querySelector(".de-fields");
    // [label, path, min, max, step, isDegrees]
    const F = [
      ["Size", "length", 0.1, 2, 0.01, false],
      ["Pos X (right)", "position.0", -1, 1, 0.005, false],
      ["Pos Y (up)", "position.1", -1, 1, 0.005, false],
      ["Pos Z (fwd)", "position.2", -1.2, 0, 0.005, false],
      ["Rot X (pitch)", "extraRotation.0", -180, 180, 1, true],
      ["Rot Y (yaw)", "extraRotation.1", -180, 180, 1, true],
      ["Rot Z (roll)", "extraRotation.2", -180, 180, 1, true],
      ["Muzzle X", "muzzleOffset.0", -0.5, 0.5, 0.005, false],
      ["Muzzle Y", "muzzleOffset.1", -0.5, 0.5, 0.005, false],
      ["Muzzle Z", "muzzleOffset.2", -0.5, 0.5, 0.005, false],
    ];
    for (const [label, path, min, max, step, deg] of F) {
      fields.appendChild(this._makeRow(label, path, min, max, step, deg));
    }

    // Flip checkbox.
    const flipRow = document.createElement("label");
    flipRow.className = "de-row de-check";
    flipRow.innerHTML = `<span>Flip barrel</span><input type="checkbox" />`;
    const flipBox = flipRow.querySelector("input");
    this.flipBox = flipBox;
    flipBox.checked = this.vm.flip;
    flipBox.addEventListener("change", () => {
      this.vm.flip = flipBox.checked;
      this.apply();
    });
    fields.appendChild(flipRow);

    // Segment buttons (drag target).
    panel.querySelectorAll(".de-seg-btns button").forEach((b) => {
      b.addEventListener("click", () => {
        this.dragTarget = b.dataset.target;
        panel.querySelectorAll(".de-seg-btns button").forEach((x) =>
          x.classList.toggle("on", x === b)
        );
      });
    });

    panel.querySelector(".de-x").addEventListener("click", () => this.toggle(false));
    panel.querySelector(".de-save").addEventListener("click", () => this.save());
    panel.querySelector(".de-copy").addEventListener("click", () => this.copy());
  }

  _makeRow(label, path, min, max, step, deg) {
    const row = document.createElement("div");
    row.className = "de-row";
    const raw = this._get(path);
    const shown = deg ? Math.round(raw * DEG) : raw;
    row.innerHTML = `
      <label>${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${shown}" />
      <input type="number" min="${min}" max="${max}" step="${step}" value="${shown}" />
    `;
    const range = row.querySelector('input[type="range"]');
    const number = row.querySelector('input[type="number"]');
    this.inputs[path] = { range, number, deg };

    const onInput = (src) => {
      const val = parseFloat(src.value);
      if (Number.isNaN(val)) return;
      (src === range ? number : range).value = val;
      this._set(path, deg ? val * RAD : val);
      this.apply();
    };
    range.addEventListener("input", () => onInput(range));
    number.addEventListener("input", () => onInput(number));
    return row;
  }

  // ----- vm get/set by "a.b.idx" path -----
  _get(path) {
    const [key, idx] = path.split(".");
    return idx === undefined ? this.vm[key] : this.vm[key][+idx];
  }
  _set(path, value) {
    const [key, idx] = path.split(".");
    if (idx === undefined) this.vm[key] = value;
    else this.vm[key][+idx] = value;
  }

  // Push UI value back into an input (used by drag/scroll).
  _syncInput(path) {
    const inp = this.inputs[path];
    if (!inp) return;
    const raw = this._get(path);
    const shown = inp.deg ? Math.round(raw * DEG) : +raw.toFixed(4);
    inp.range.value = shown;
    inp.number.value = shown;
  }

  apply() {
    this.weapon.setViewmodel(structuredClone(this.vm));
  }

  // ----- Toggle -----
  _bindGlobalKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Backquote") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force) {
    const want = force === undefined ? !this.active : force;
    if (want && !this.getWeapon()) return; // no active weapon (not in a match)
    this.active = want;
    if (this.active) this.refresh(); // re-read whichever weapon is now active
    document.body.classList.toggle("editor-open", this.active);
    this.panel.style.display = this.active ? "block" : "none";
    this.weapon.debugMuzzle = this.active;
    if (this.active && document.pointerLockElement) document.exitPointerLock();
  }

  // Point the editor at the currently active weapon and sync all inputs to it.
  refresh() {
    const res = this.getWeapon();
    if (!res) return;
    if (this.weapon) this.weapon.debugMuzzle = false; // clear old gun's marker
    const { weapon, key } = res;
    this.weapon = weapon;
    this.weaponKey = key;
    this.weapon.debugMuzzle = this.active;
    this.vm = structuredClone(weapon.cfg.viewmodel);
    this.normalizeVm();
    for (const path in this.inputs) this._syncInput(path);
    if (this.flipBox) this.flipBox.checked = this.vm.flip;
    const title = this.panel.querySelector(".de-head span");
    if (title) title.textContent = `🛠 ${key} viewmodel`;
  }

  // ----- Viewport drag + scroll -----
  _bindViewport() {
    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.active || e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    window.addEventListener("mousemove", (e) => {
      if (!this.active || !this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      // Pixels -> world units at the gun's distance.
      const dist = Math.abs(this.vm.position[2]) || 0.5;
      const fov = (this.camera.fov * Math.PI) / 180;
      const perPx = (2 * Math.tan(fov / 2) * dist) / window.innerHeight;
      const wx = dx * perPx;
      const wy = -dy * perPx;

      if (this.dragTarget === "gun") {
        this.vm.position[0] += wx;
        this.vm.position[1] += wy;
        this._syncInput("position.0");
        this._syncInput("position.1");
      } else {
        // Muzzle X is mirrored when flipped, so invert drag-X to keep it intuitive.
        this.vm.muzzleOffset[0] += this.vm.flip ? -wx : wx;
        this.vm.muzzleOffset[1] += wy;
        this._syncInput("muzzleOffset.0");
        this._syncInput("muzzleOffset.1");
      }
      this.apply();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        const step = e.deltaY < 0 ? 1 : -1;
        if (this.dragTarget === "gun") {
          this.vm.length = Math.max(0.1, +(this.vm.length + step * 0.02).toFixed(3));
          this._syncInput("length");
        } else {
          this.vm.muzzleOffset[2] = +(this.vm.muzzleOffset[2] + step * 0.01).toFixed(3);
          this._syncInput("muzzleOffset.2");
        }
        this.apply();
      },
      { passive: false }
    );
  }

  // ----- Persist -----
  _payload() {
    return { [this.weaponKey]: { viewmodel: structuredClone(this.vm) } };
  }

  async save() {
    const status = this.panel.querySelector(".de-status");
    try {
      const res = await fetch("/__save-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this._payload()),
      });
      const json = await res.json();
      status.textContent = json.ok ? "✅ Saved to weapon-overrides.json" : `❌ ${json.error}`;
      status.className = "de-status " + (json.ok ? "ok" : "err");
    } catch (err) {
      status.textContent = "❌ Save failed (dev server only): " + err.message;
      status.className = "de-status err";
    }
  }

  async copy() {
    const status = this.panel.querySelector(".de-status");
    await navigator.clipboard.writeText(JSON.stringify(this._payload(), null, 2));
    status.textContent = "⧉ Copied JSON to clipboard";
    status.className = "de-status ok";
  }

  _injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #dev-editor {
        position: fixed; top: 12px; right: 12px; width: 270px; z-index: 50;
        display: none; max-height: 92vh; overflow-y: auto;
        background: rgba(13,17,23,0.95); border: 1px solid #30425c; border-radius: 10px;
        color: #e6edf3; font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
        font-size: 12px; padding: 10px 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      }
      #dev-editor .de-head { display:flex; justify-content:space-between; align-items:center;
        font-weight:700; font-size:13px; margin-bottom:6px; color:#7ee787; }
      #dev-editor .de-x { background:none; border:none; color:#8b949e; cursor:pointer; font-size:14px; }
      #dev-editor .de-hint { color:#8b949e; font-size:11px; margin-bottom:8px; }
      #dev-editor .de-row { display:grid; grid-template-columns: 84px 1fr 52px; gap:6px;
        align-items:center; margin:4px 0; }
      #dev-editor .de-row label { color:#c9d4e0; }
      #dev-editor input[type=range] { width:100%; }
      #dev-editor input[type=number] { width:100%; background:#0d1117; color:#e6edf3;
        border:1px solid #30425c; border-radius:4px; padding:2px 4px; font-family:inherit; font-size:11px; }
      #dev-editor .de-seg { grid-template-columns: 84px 1fr; }
      #dev-editor .de-seg-btns { display:flex; gap:4px; }
      #dev-editor .de-seg-btns button { flex:1; background:#0d1117; color:#8b949e;
        border:1px solid #30425c; border-radius:4px; padding:4px; cursor:pointer; font-family:inherit; }
      #dev-editor .de-seg-btns button.on { background:#1f6feb; color:#fff; border-color:#1f6feb; }
      #dev-editor .de-check { grid-template-columns: 1fr auto; margin-top:6px; cursor:pointer; }
      #dev-editor .de-actions { display:flex; gap:6px; margin-top:10px; }
      #dev-editor .de-actions button { flex:1; padding:7px; border-radius:6px; cursor:pointer;
        border:1px solid #30425c; background:#238636; color:#fff; font-weight:700; font-family:inherit; }
      #dev-editor .de-actions .de-copy { background:#21262d; }
      #dev-editor .de-status { margin-top:8px; font-size:11px; min-height:14px; }
      #dev-editor .de-status.ok { color:#7ee787; }
      #dev-editor .de-status.err { color:#ff7b72; }
      body.editor-open #lock-overlay { display:none !important; }
      body.editor-open #app { cursor: crosshair; }
    `;
    document.head.appendChild(s);
  }
}
