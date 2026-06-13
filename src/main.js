import * as THREE from "three";
import { initInput, consumeMouse, isLocked } from "./input.js";
import { buildWorld, updateTargets } from "./world.js";
import { Player } from "./player.js";
import { Loadout } from "./loadout.js";
import { FloatingText } from "./floatingText.js";
import { DevEditor } from "./devEditor.js";
import { Menu } from "./menu.js";
import { NetPlayers } from "./net.js";

// ---------------------------------------------------------------------------
// Renderer / scene / camera (built immediately so the menu has a 3D backdrop)
// ---------------------------------------------------------------------------
const canvas = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
scene.add(camera);

const world = buildWorld(scene);
const player = new Player(camera, [0, 25]);
const fx = new FloatingText(camera);

// Set the camera somewhere nice for the menu backdrop.
camera.position.set(0, 6, 30);
camera.lookAt(0, 1, 0);

// ---------------------------------------------------------------------------
// HUD refs
// ---------------------------------------------------------------------------
const ui = {
  score: document.getElementById("score"),
  ammo: document.getElementById("ammo"),
  reserve: document.getElementById("reserve"),
  reloading: document.getElementById("reloading"),
  health: document.getElementById("health-bar"),
  hitmarker: document.getElementById("hitmarker"),
  weaponName: document.getElementById("weapon-name"),
  deaths: document.getElementById("deaths"),
  killfeed: document.getElementById("killfeed"),
  dmgFlash: document.getElementById("dmg-flash"),
};
let score = 0;
let deaths = 0;
let hitmarkerTimer = 0;
function flashHitmarker() {
  ui.hitmarker.style.opacity = "1";
  hitmarkerTimer = 0.12;
}

const SPAWNS = [
  [0, 25], [25, 0], [-25, 0], [0, -25],
  [20, 20], [-20, -20], [20, -20], [-20, 20],
];

function showDamageFlash() {
  const el = ui.dmgFlash;
  el.style.transition = "none";
  el.style.opacity = "0.6";
  requestAnimationFrame(() => {
    el.style.transition = "opacity 0.45s ease-out";
    el.style.opacity = "0";
  });
}

function addKillFeed(killer, victim) {
  const line = document.createElement("div");
  line.className = "kf";
  line.innerHTML = `<span class="killer">${esc(killer)}</span> 💀 <span class="victim">${esc(victim)}</span>`;
  ui.killfeed.appendChild(line);
  setTimeout(() => line.remove(), 4500);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function respawn() {
  const [x, z] = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  player.pos.set(x, 0, z);
  player.velY = 0;
  player.onGround = true;
  player.health = 100;
}

// We took damage from another player (their client reported the hit).
function takeDamage({ damage, from, fromName }) {
  if (!started) return;
  player.health -= damage;
  showDamageFlash();
  if (player.health <= 0) {
    deaths++;
    ui.deaths.textContent = String(deaths);
    addKillFeed(fromName || "Someone", playerName);
    net.sendDeath(from, fromName);
    respawn();
  }
}

// Someone died (we may be the killer, victim, or a spectator).
function onKillEvent(p) {
  addKillFeed(p.killerName || "Someone", p.victimName || "Player");
  if (net && p.killer === net.localId) {
    score++;
    ui.score.textContent = String(score);
  }
}

// ---------------------------------------------------------------------------
// Match state (set on deploy)
// ---------------------------------------------------------------------------
let loadout = null;
let lobby = null;
let net = null;
let playerName = "Player";
let started = false;

initInput(canvas, document.getElementById("lock-overlay"));

const menu = new Menu({
  onDeploy(slots, joinedLobby) {
    lobby = joinedLobby;
    playerName = (lobby && lobby.playerName) || "Player";
    loadout = new Loadout(scene, camera, slots);
    net = new NetPlayers(scene, camera, lobby);
    net.localName = playerName;
    net.onDamaged = takeDamage;
    net.onKill = onKillEvent;
    started = true;
    document.body.classList.add("playing");
    document.getElementById("lock-overlay").classList.remove("hidden");
    refreshWeaponHud();

    if (import.meta.env.DEV && !devEditor) {
      devEditor = new DevEditor(
        () => (loadout ? { weapon: loadout.current, key: loadout.currentKey } : null),
        camera,
        canvas
      );
    }
  },
});

// Tear down the current match and return to the menu.
function leaveMatch() {
  if (!started) return;
  started = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (devEditor && devEditor.active) devEditor.toggle(false);

  if (loadout) loadout.dispose();
  if (net) net.dispose();
  loadout = null;
  net = null;
  lobby = null;

  // Reset HUD + player state.
  score = 0;
  deaths = 0;
  ui.score.textContent = "0";
  ui.deaths.textContent = "0";
  ui.killfeed.innerHTML = "";
  ui.hitmarker.style.opacity = "0";
  player.health = 100;
  player.pos.set(0, 0, 25);
  player.velY = 0;

  document.body.classList.remove("playing");
  document.getElementById("lock-overlay").classList.add("hidden");

  // Restore the menu backdrop camera and reopen the menu.
  camera.position.set(0, 6, 30);
  camera.lookAt(0, 1, 0);
  menu.lobby = null;
  menu.showMain();
  menu.show();
}

document.getElementById("leave-match").addEventListener("click", (e) => {
  e.stopPropagation(); // don't let the overlay re-request pointer lock
  leaveMatch();
});

// ---------------------------------------------------------------------------
// Weapon switching
// ---------------------------------------------------------------------------
let devEditor = null;

function refreshWeaponHud() {
  if (loadout) ui.weaponName.textContent = loadout.current.cfg.displayName;
}

window.addEventListener("keydown", (e) => {
  if (!started) return;
  let swapped = false;
  if (e.code === "Digit1") swapped = loadout.switchTo("primary");
  else if (e.code === "Digit2") swapped = loadout.switchTo("secondary");
  else if (e.code === "KeyQ") swapped = loadout.toggle();
  if (swapped) {
    refreshWeaponHud();
    if (devEditor && devEditor.active) devEditor.refresh();
  }
});

// Reload key (held) — weapon.reload() guards against re-triggering.
let reloadHeld = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") reloadHeld = true;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "KeyR") reloadHeld = false;
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const mouse = consumeMouse();

  if (started && isLocked()) {
    player.update(dt, mouse, world.colliders);

    const weapon = loadout.current;
    const fireInput = weapon.cfg.automatic ? mouse.left : mouse.leftEdge;
    if (fireInput) {
      // Raycast against the world plus remote players.
      const solids = net && net.hitMeshes.length ? world.solids.concat(net.hitMeshes) : world.solids;
      const shot = weapon.tryShoot(world.targets, solids, (info) => {
        if (info.headshot) {
          fx.spawn(info.point, `${info.damage} HEADSHOT`, { color: "#ffd54a", size: 26, life: 1.1 });
        } else {
          fx.spawn(info.point, String(info.damage), { color: "#ff6b6b", size: 22 });
        }
        if (info.killed) {
          const killPos = info.point.clone();
          killPos.y += 0.6;
          fx.spawn(killPos, "KILL", { color: "#3fb950", size: 24, life: 1.2, rise: 1.0 });
          score++;
          ui.score.textContent = String(score);
        }
      });
      if (shot) {
        if (shot.hit) flashHitmarker();
        if (shot.playerHit) {
          const ph = shot.playerHit;
          fx.spawn(
            ph.point,
            ph.headshot ? `${ph.damage} HEADSHOT` : String(ph.damage),
            ph.headshot
              ? { color: "#ffd54a", size: 26, life: 1.1 }
              : { color: "#ff6b6b", size: 22 }
          );
          net.flashRemote(ph.id);
          net.sendHit(ph.id, ph.damage, ph.headshot);
        }
        net.broadcastShot(shot); // let other players see the tracer
      }
    }
    if (reloadHeld) weapon.reload();

    net.sendLocal(player, playerName, dt); // broadcast our position
  }

  if (loadout) loadout.update(dt);
  if (net) net.update(dt);
  updateTargets(world.targets, dt);
  fx.update(dt);

  // HUD
  if (started) {
    const weapon = loadout.current;
    ui.ammo.textContent = String(weapon.ammo);
    ui.reserve.textContent = String(weapon.reserve);
    ui.reloading.style.visibility = weapon.reloading > 0 ? "visible" : "hidden";
    ui.health.style.width = `${player.health}%`;
    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt;
      if (hitmarkerTimer <= 0) ui.hitmarker.style.opacity = "0";
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
