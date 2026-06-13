import * as THREE from "three";

// Spawns short-lived DOM labels anchored to a world position, projected to the
// screen each frame. Used for damage numbers, "HEADSHOT", "KILL", etc.
export class FloatingText {
  constructor(camera) {
    this.camera = camera;
    this.layer = document.getElementById("fx-layer");
    this.items = [];
  }

  // worldPos: THREE.Vector3 of the hit; opts: { color, size, life, rise, drift }
  spawn(worldPos, text, opts = {}) {
    const el = document.createElement("div");
    el.className = "dmg";
    el.textContent = text;
    el.style.color = opts.color || "#ffffff";
    el.style.fontSize = (opts.size || 22) + "px";
    this.layer.appendChild(el);

    this.items.push({
      el,
      anchor: worldPos.clone(),
      age: 0,
      life: opts.life ?? 0.9,
      rise: opts.rise ?? 1.4,           // world units it floats upward
      drift: opts.drift ?? (Math.random() - 0.5) * 0.6, // sideways wander
    });
  }

  update(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const t = it.age / it.life;

      if (t >= 1) {
        it.el.remove();
        this.items.splice(i, 1);
        continue;
      }

      // World position rises (and drifts) over its lifetime, then project.
      v.copy(it.anchor);
      v.x += it.drift * t;
      v.y += it.rise * t;
      v.project(this.camera);

      // Behind the camera or off-screen: hide this frame.
      if (v.z > 1) {
        it.el.style.opacity = "0";
        continue;
      }

      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const pop = t < 0.15 ? 1 + (0.15 - t) * 3 : 1; // quick scale-up on spawn
      it.el.style.left = x + "px";
      it.el.style.top = y + "px";
      it.el.style.transform = `translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      it.el.style.opacity = String(Math.max(0, 1 - t * t)); // ease-out fade
    }
  }
}
