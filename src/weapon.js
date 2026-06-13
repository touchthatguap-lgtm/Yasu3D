import * as THREE from "three";
import { loadModel } from "./assets.js";

const RANGE = 200;
const TARGET_RESPAWN = 2.5; // seconds a target stays "dead"

export class Weapon {
  constructor(scene, camera, cfg) {
    this.scene = scene;
    this.camera = camera;
    this.cfg = cfg;

    this.ammo = cfg.magSize;
    this.reserve = cfg.reserve;
    this.cooldown = 0;
    this.reloading = 0;
    this.recoil = 0;

    this.basePos = new THREE.Vector3(...cfg.viewmodel.position);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RANGE;

    this.tracers = [];

    this._buildViewmodel();
    this._loadModel(cfg).catch((err) => {
      console.warn(`[Yasu3D] failed to load ${cfg.model}:`, err.message);
      // Placeholder stays visible if the model fails to load.
    });
  }

  _buildViewmodel() {
    this.gun = new THREE.Group();
    this.gun.position.copy(this.basePos);
    this.camera.add(this.gun);

    // Temporary placeholder shown until the real model finishes loading.
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 });
    this.placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.5), mat);
    this.gun.add(this.placeholder);

    // Muzzle flash + light (re-parented onto the model once it loads).
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a })
    );
    this.muzzle.visible = false;
    this.muzzleLight = new THREE.PointLight(0xffb347, 0, 6);
    this.muzzle.position.set(0, 0, -0.3);
    this.muzzleLight.position.copy(this.muzzle.position);
    this.gun.add(this.muzzle, this.muzzleLight);
  }

  async _loadModel(cfg) {
    // Either build procedurally or load a model file.
    const model = cfg.build ? cfg.build() : (await loadModel(cfg.model)).scene;
    if (cfg.build) {
      model.traverse((n) => {
        if (n.isMesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
    }

    // Swap the placeholder for the real model.
    this.gun.remove(this.placeholder);
    this.gun.add(model);
    this.model = model;

    this._applyModelTransform(cfg.viewmodel);
  }

  // (Re)applies orient + scale + recenter + muzzle placement from a viewmodel
  // config. Safe to call live (the dev editor uses this).
  _applyModelTransform(vm) {
    const model = this.model;
    if (!model) return;

    // Detach so bounding-box math is in the model's own space, not camera space.
    const parent = model.parent;
    if (parent) parent.remove(model);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);

    // --- Auto-orient: rotate the longest axis to point forward (-Z). ---
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = [size.x, size.y, size.z].indexOf(Math.max(size.x, size.y, size.z));
    if (longest === 0) model.rotateY(Math.PI / 2);
    else if (longest === 1) model.rotateX(-Math.PI / 2);
    if (vm.flip) model.rotateY(Math.PI);

    const er = vm.extraRotation || [0, 0, 0];
    model.rotateX(er[0]);
    model.rotateY(er[1]);
    model.rotateZ(er[2]);

    // --- Auto-scale so the longest dimension == vm.length ---
    box.setFromObject(model);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar((vm.length || 0.5) / maxDim);

    // --- Recenter on the group origin ---
    box.setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.sub(center);

    // --- Muzzle at the forward (-Z) tip, plus manual offset ---
    // Measured here while the model is still DETACHED, so the box is in the
    // model's local space (not world space — which would include the camera).
    // Flipping is a 180° spin that mirrors X, so mirror the manual X offset too,
    // keeping the flash glued to the same barrel point through a flip.
    box.setFromObject(model);
    const mo = vm.muzzleOffset || [0, 0, 0];
    const sx = vm.flip ? -1 : 1;
    this.muzzle.position.set(mo[0] * sx, mo[1], box.min.z - 0.03 + mo[2]);
    this.muzzleLight.position.copy(this.muzzle.position);

    if (parent) parent.add(model);
  }

  // Live-update from the dev editor.
  setViewmodel(vm) {
    this.cfg.viewmodel = vm;
    this.basePos.set(...vm.position);
    this._applyModelTransform(vm);
  }

  reload() {
    if (this.reloading > 0 || this.ammo === this.cfg.magSize || this.reserve === 0) return;
    this.reloading = this.cfg.reloadTime;
  }

  // Remove the viewmodel and any live tracers (called when leaving a match).
  dispose() {
    this.camera.remove(this.gun);
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
    }
    this.tracers = [];
  }

  // onHit({ point, damage, headshot, killed }) is called when a target is struck.
  // Returns { start, end, hit } when a shot is actually fired, else null — so the
  // caller can broadcast the tracer to other players.
  tryShoot(targets, solids, onHit) {
    if (this.reloading > 0 || this.cooldown > 0) return null;
    if (this.ammo <= 0) {
      this.reload();
      return null;
    }
    this.ammo--;
    this.cooldown = this.cfg.fireCooldown;
    this.recoil = Math.min(this.recoil + 0.05, 0.12);

    this.muzzle.visible = true;
    this.muzzleLight.intensity = 4;
    this._flashTimer = 0.04;

    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);
    this.raycaster.set(origin, dir);

    const hits = this.raycaster.intersectObjects(solids, false);
    let endPoint = origin.clone().add(dir.clone().multiplyScalar(RANGE));
    let hitTarget = false;
    let playerHit = null;

    if (hits.length) {
      const hit = hits[0];
      endPoint = hit.point.clone();
      const ud = hit.object.userData;
      const target = ud.target;
      if (target && target.alive) {
        // Practice dummy.
        const headshot = ud.part === "head";
        const damage = headshot ? this.cfg.headDamage : this.cfg.bodyDamage;
        target.health -= damage;
        target.flash = 0.12;
        const killed = target.health <= 0;
        if (killed) {
          target.alive = false;
          target.respawnAt = TARGET_RESPAWN;
          target.mesh.visible = false;
        }
        hitTarget = true;
        if (onHit) onHit({ point: hit.point.clone(), damage, headshot, killed });
      } else if (ud.netId) {
        // Another player.
        const headshot = ud.part === "head";
        const damage = headshot ? this.cfg.headDamage : this.cfg.bodyDamage;
        playerHit = { id: ud.netId, damage, headshot, point: hit.point.clone() };
        hitTarget = true;
      }
    }

    const start = this._spawnTracer(endPoint);
    return { start: start.toArray(), end: endPoint.toArray(), hit: hitTarget, playerHit };
  }

  _spawnTracer(end) {
    const start = new THREE.Vector3();
    this.muzzle.getWorldPosition(start);
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
    return start;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this.recoil *= Math.pow(0.0008, dt);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.cfg.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = 0;
      }
    }

    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) {
        this.muzzle.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    // Dev editor: keep the muzzle marker visible so it can be aligned.
    if (this.debugMuzzle) {
      this.muzzle.visible = true;
      this.muzzleLight.intensity = Math.max(this.muzzleLight.intensity, 1.2);
    }

    // --- Viewmodel pose (relative to the configured base position) ---
    const b = this.basePos;
    if (this.reloading > 0) {
      const p = 1 - this.reloading / this.cfg.reloadTime;
      const dip = Math.sin(p * Math.PI);
      const spin = Math.sin(p * Math.PI) ** 2;
      this.gun.position.set(b.x - dip * 0.05, b.y - dip * 0.22, b.z + dip * 0.06);
      this.gun.rotation.set(dip * 1.0, 0, spin * 0.6);
    } else {
      this.gun.position.set(b.x, b.y + this.recoil * 0.3, b.z + this.recoil);
      this.gun.rotation.set(-this.recoil * 1.5, 0, 0);
    }

    // Tracer fade.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
