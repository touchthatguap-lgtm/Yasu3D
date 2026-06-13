import * as THREE from "three";

const MAG_SIZE = 30;
const RESERVE_START = 90;
const FIRE_COOLDOWN = 0.1;   // seconds between shots (~600 rpm)
const RELOAD_TIME = 1.4;     // seconds
const RANGE = 200;
const TARGET_RESPAWN = 2.5;  // seconds a target stays "dead"

export class Weapon {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.ammo = MAG_SIZE;
    this.reserve = RESERVE_START;
    this.cooldown = 0;
    this.reloading = 0;
    this.recoil = 0; // visual kick, decays each frame

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RANGE;

    this._buildViewmodel();

    // Pool of tracer line segments we fade out over time.
    this.tracers = [];
  }

  _buildViewmodel() {
    // Simple low-poly gun parented to the camera so it follows the view.
    this.gun = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.55), bodyMat);
    body.position.set(0, 0, -0.15);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.45), bodyMat);
    barrel.position.set(0, 0.02, -0.5);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.1), bodyMat);
    grip.position.set(0, -0.15, 0.02);
    grip.rotation.x = 0.25;
    this.gun.add(body, barrel, grip);

    // Muzzle flash (hidden until firing).
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a })
    );
    this.muzzle.position.set(0, 0.02, -0.74);
    this.muzzle.visible = false;
    this.gun.add(this.muzzle);

    this.muzzleLight = new THREE.PointLight(0xffb347, 0, 6);
    this.muzzleLight.position.copy(this.muzzle.position);
    this.gun.add(this.muzzleLight);

    // Rest pose: lower-right of the view.
    this.gun.position.set(0.22, -0.2, -0.5);
    this.camera.add(this.gun);
  }

  reload() {
    if (this.reloading > 0 || this.ammo === MAG_SIZE || this.reserve === 0) return;
    this.reloading = RELOAD_TIME;
  }

  // Returns true if a target was hit (so main can flash the hit marker).
  tryShoot(targets, solids, onHit) {
    if (this.reloading > 0 || this.cooldown > 0) return false;
    if (this.ammo <= 0) {
      this.reload();
      return false;
    }
    this.ammo--;
    this.cooldown = FIRE_COOLDOWN;
    this.recoil = Math.min(this.recoil + 0.05, 0.12);

    // Muzzle flash on.
    this.muzzle.visible = true;
    this.muzzleLight.intensity = 4;
    this._flashTimer = 0.04;

    // Raycast straight out of the camera center.
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);
    this.raycaster.set(origin, dir);

    const hits = this.raycaster.intersectObjects(solids, false);
    let endPoint = origin.clone().add(dir.clone().multiplyScalar(RANGE));
    let hitTarget = false;

    if (hits.length) {
      const hit = hits[0];
      endPoint = hit.point.clone();
      const target = hit.object.userData.target;
      if (target && target.alive) {
        const headshot = hit.object.userData.part === "head";
        const damage = headshot ? 100 : 34;
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
      }
    }

    // Spawn a tracer from the muzzle tip to the hit point.
    this._spawnTracer(endPoint);
    return hitTarget;
  }

  _spawnTracer(end) {
    const start = new THREE.Vector3();
    this.muzzle.getWorldPosition(start);
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  update(dt, targets) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this.recoil *= Math.pow(0.0008, dt); // fast decay

    // Reload countdown.
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = MAG_SIZE - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = 0;
      }
    }

    // Muzzle flash decay.
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) {
        this.muzzle.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    // --- Viewmodel pose ---
    if (this.reloading > 0) {
      // Reload animation: gun dips down, tilts, and swings back up.
      const p = 1 - this.reloading / RELOAD_TIME; // 0 -> 1 over the reload
      const dip = Math.sin(p * Math.PI);          // 0 at start/end, 1 mid-way
      const spin = Math.sin(p * Math.PI) ** 2;    // sharper mid-reload twist
      this.gun.position.x = 0.22 - dip * 0.05;
      this.gun.position.y = -0.2 - dip * 0.22;
      this.gun.position.z = -0.5 + dip * 0.06;
      this.gun.rotation.x = dip * 1.0;
      this.gun.rotation.z = spin * 0.6;
    } else {
      // Idle/firing pose with recoil kick.
      this.gun.position.x = 0.22;
      this.gun.position.z = -0.5 + this.recoil;
      this.gun.position.y = -0.2 + this.recoil * 0.3;
      this.gun.rotation.x = -this.recoil * 1.5;
      this.gun.rotation.z = 0;
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

    // Target hit-flash + respawn.
    for (const target of targets) {
      // Flash bright white briefly when hit.
      if (target.flash > 0) {
        target.flash = Math.max(0, target.flash - dt);
        const k = target.flash / 0.12;
        target.mat.emissive.setRGB(0.38 + k * 0.6, 0.18 + k * 0.6, k * 0.6);
      }
      if (!target.alive) {
        target.respawnAt -= dt;
        if (target.respawnAt <= 0) {
          target.alive = true;
          target.health = target.maxHealth;
          target.mesh.visible = true;
          target.mat.emissive.setHex(0x612f00);
        }
      }
    }
  }
}
