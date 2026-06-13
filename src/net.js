import * as THREE from "three";
import { loadModel } from "./assets.js";
import { CHARACTERS, DEFAULT_CHARACTER } from "./characters.js";

// Syncs other players over the lobby's Realtime channel:
//  - broadcasts our position/rotation ~15x/sec
//  - spawns + smoothly interpolates remote avatars
//  - draws remote shot tracers
//  - removes avatars that go stale (disconnect / leave)

const SEND_RATE = 1 / 15;     // seconds between outgoing state broadcasts
const STALE_AFTER = 3;        // seconds without an update -> remove avatar
const REMOTE_COLOR = 0xff5252;

export class NetPlayers {
  constructor(scene, camera, lobby) {
    this.scene = scene;
    this.camera = camera;
    this.lobby = lobby;
    this.localId = lobby ? lobby.id : null;
    this.enabled = Boolean(lobby && lobby.online);

    this.remotes = new Map(); // id -> { group, mat, name, label, cur, tgt, yaw, tgtYaw, last, flash }
    this.hitMeshes = [];      // raycast targets for PvP (body/head of every remote)
    this.tracers = [];
    this.sendTimer = 0;
    this.clock = 0;

    this.localName = "Player";
    this.localChar = DEFAULT_CHARACTER; // which character avatar we broadcast
    this.onDamaged = null;    // ({ from, fromName, damage, headshot }) when we get hit
    this.onKill = null;       // (deathPayload) when anyone dies
    this.onRemoteShot = null; // (shotPayload) when another player fires

    if (this.enabled) {
      lobby.onState = (s) => this._onState(s);
      lobby.onShot = (s) => this._onShot(s);
      lobby.onHit = (p) => this._onHit(p);
      lobby.onDeath = (p) => this.onKill && this.onKill(p);
    }
  }

  _onHit(p) {
    if (!p || p.target !== this.localId) return; // only care about hits on us
    if (this.onDamaged) this.onDamaged(p);
  }

  // Tell a victim we hit them (their client applies the damage).
  sendHit(targetId, damage, headshot) {
    if (!this.enabled) return;
    this.lobby.sendHit({
      target: targetId,
      from: this.localId,
      fromName: this.localName,
      damage,
      headshot,
    });
  }

  // Announce our own death, crediting the killer.
  sendDeath(killerId, killerName) {
    if (!this.enabled) return;
    this.lobby.sendDeath({
      victim: this.localId,
      victimName: this.localName,
      killer: killerId,
      killerName,
    });
  }

  flashRemote(id) {
    const r = this.remotes.get(id);
    if (r) r.flash = 0.12;
  }

  // Tear down all avatars/labels/tracers and leave the lobby channel.
  dispose() {
    for (const id of [...this.remotes.keys()]) this._remove(id);
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
    }
    this.tracers = [];
    if (this.lobby) this.lobby.leave();
  }

  // --- Incoming ---
  _onState(s) {
    if (!s || s.id === this.localId) return;
    let r = this.remotes.get(s.id);
    if (!r) r = this._spawn(s.id, s.name, s.char);
    r.tgt.set(s.x, s.y, s.z);
    r.tgtYaw = s.yaw;
    r.last = this.clock;
    if (s.name && r.name !== s.name) {
      r.name = s.name;
      r.label.textContent = s.name;
    }
  }

  _onShot(s) {
    if (!s || s.id === this.localId) return;
    this._spawnTracer(
      new THREE.Vector3(s.sx, s.sy, s.sz),
      new THREE.Vector3(s.ex, s.ey, s.ez)
    );
    if (this.onRemoteShot) this.onRemoteShot(s);
  }

  // --- Remote avatar ---
  _spawn(id, name, charName) {
    const group = new THREE.Group();

    // Invisible hitbox (body + head) used only for raycasting. Kept constant
    // regardless of the visible character model so hits/headshots are fair.
    const hitMat = new THREE.MeshBasicMaterial();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), hitMat);
    body.position.y = 0.9;
    body.visible = false; // invisible meshes are still raycast by Three.js
    body.userData = { netId: id, part: "body" };
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), hitMat);
    head.position.y = 1.7;
    head.visible = false;
    head.userData = { netId: id, part: "head" };
    this.hitMeshes.push(body, head);
    group.add(body, head);
    this.scene.add(group);

    const label = document.createElement("div");
    label.className = "net-name";
    label.textContent = name || "Player";
    document.getElementById("fx-layer").appendChild(label);

    const r = {
      group,
      name: name || "Player",
      label,
      cur: new THREE.Vector3(),
      tgt: new THREE.Vector3(),
      yaw: 0,
      tgtYaw: 0,
      last: this.clock,
      flash: 0,
      removed: false,
      visual: null,    // the loaded character model
      tintMats: [],    // materials flashed white on hit
    };
    this.remotes.set(id, r);
    this._loadCharacter(r, charName);
    return r;
  }

  // Load the player's selected character model and add it to their avatar group.
  // Async (model files), so the hitbox already exists for hit detection.
  async _loadCharacter(r, charName) {
    const cfg = CHARACTERS[charName] || CHARACTERS[DEFAULT_CHARACTER];
    let visual;
    try {
      visual = cfg.build ? cfg.build() : (await loadModel(cfg.model)).scene;
    } catch (e) {
      console.warn("[Yasu3D] character load failed:", charName, e.message);
      visual = CHARACTERS[DEFAULT_CHARACTER].build();
    }
    if (r.removed) {
      // The player left while the model was loading — throw it away.
      this._disposeTree(visual);
      return;
    }
    if (cfg.model) this._fitCharacter(visual, cfg);

    // Collect materials we can flash white when this player is hit.
    visual.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = true;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) if (m && m.emissive) r.tintMats.push(m);
    });

    r.visual = visual;
    r.group.add(visual);
  }

  // Scale an imported model to a target height, drop its feet to y=0, recenter
  // it horizontally, and apply a facing correction.
  _fitCharacter(visual, cfg) {
    const box = new THREE.Box3().setFromObject(visual);
    const size = box.getSize(new THREE.Vector3());
    visual.scale.setScalar((cfg.height || 1.9) / (size.y || 1));
    if (cfg.faceFix) visual.rotateY(cfg.faceFix);

    box.setFromObject(visual);
    const center = box.getCenter(new THREE.Vector3());
    visual.position.x -= center.x;
    visual.position.z -= center.z;
    visual.position.y -= box.min.y;
  }

  _disposeTree(obj) {
    obj.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
  }

  _remove(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.removed = true; // signal any in-flight character load to bail
    this.scene.remove(r.group);
    r.group.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        n.material.dispose();
      }
    });
    // Drop this avatar's meshes from the raycast list.
    this.hitMeshes = this.hitMeshes.filter((m) => m.userData.netId !== id);
    r.label.remove();
    this.remotes.delete(id);
  }

  _spawnTracer(start, end) {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.12 });
  }

  // --- Outgoing (call every frame with the local player) ---
  sendLocal(player, name, dt) {
    if (!this.enabled) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = SEND_RATE;
    this.lobby.sendState({
      id: this.localId,
      name,
      char: this.localChar,
      x: +player.pos.x.toFixed(2),
      y: +player.pos.y.toFixed(2),
      z: +player.pos.z.toFixed(2),
      yaw: +player.yaw.toFixed(3),
    });
  }

  broadcastShot(shot) {
    if (!this.enabled) return;
    const [sx, sy, sz] = shot.start;
    const [ex, ey, ez] = shot.end;
    this.lobby.sendShot({ id: this.localId, sx, sy, sz, ex, ey, ez });
  }

  // --- Per-frame upkeep ---
  update(dt) {
    this.clock += dt;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();
    const lerp = 1 - Math.pow(0.0001, dt); // smoothing toward target

    for (const [id, r] of this.remotes) {
      if (this.clock - r.last > STALE_AFTER) {
        this._remove(id);
        continue;
      }
      r.cur.lerp(r.tgt, lerp);
      r.group.position.copy(r.cur);

      // Hit flash (white) when we land a shot on them.
      if (r.flash > 0) {
        r.flash = Math.max(0, r.flash - dt);
        const k = r.flash / 0.12;
        for (const m of r.tintMats) m.emissive.setRGB(k, k, k);
      }
      // Shortest-path yaw interpolation.
      let dy = r.tgtYaw - r.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw += dy * lerp;
      r.group.rotation.y = r.yaw;

      // Name label projected to screen, above the head.
      v.set(r.cur.x, r.cur.y + 2.2, r.cur.z).project(this.camera);
      if (v.z > 1) {
        r.label.style.display = "none";
      } else {
        r.label.style.display = "block";
        r.label.style.left = (v.x * 0.5 + 0.5) * w + "px";
        r.label.style.top = (-v.y * 0.5 + 0.5) * h + "px";
      }
    }

    // Fade remote tracers.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
