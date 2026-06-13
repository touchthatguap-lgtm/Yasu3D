import * as THREE from "three";
import { loadModel } from "./assets.js";

// A small self-contained renderer that shows a single gun model spinning.
// Used by the loadout menu. Has its own scene/camera/renderer on its own canvas.
export class GunPreview {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.camera.position.set(0, 0, 3);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.8);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);

    this.holder = new THREE.Group(); // spins around Y
    this.scene.add(this.holder);

    this.model = null;
    this.running = false;
    this.reqId = null;
    this._token = 0;
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 300;
    const h = c.clientHeight || 170;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(cfg) {
    const token = ++this._token;
    if (this.model) {
      this.holder.remove(this.model);
      disposeTree(this.model);
      this.model = null;
    }

    const raw = cfg.build ? cfg.build() : (await loadModel(cfg.model)).scene;
    if (token !== this._token) {
      disposeTree(raw); // a newer selection superseded this load
      return;
    }

    // Center geometry at the wrapper origin and scale to fit the view.
    const wrapper = new THREE.Group();
    wrapper.add(raw);
    const box = new THREE.Box3().setFromObject(raw);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    raw.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    wrapper.scale.setScalar(1.9 / maxDim);
    wrapper.rotation.x = 0.18; // slight downward tilt for a nicer angle

    this.holder.add(wrapper);
    this.model = wrapper;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = () => {
      if (!this.running) return;
      this.holder.rotation.y += 0.012;
      this.renderer.render(this.scene, this.camera);
      this.reqId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this.reqId) cancelAnimationFrame(this.reqId);
    this.reqId = null;
  }
}

function disposeTree(obj) {
  obj.traverse((n) => {
    if (n.isMesh) {
      n.geometry?.dispose();
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
      else n.material?.dispose();
    }
  });
}
