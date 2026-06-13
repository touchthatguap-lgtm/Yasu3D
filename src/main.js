import * as THREE from "three";
import { initInput, consumeMouse, isLocked } from "./input.js";
import { buildWorld, updateTargets, loadMapStructures, unloadMapStructures, setArenaDecor } from "./world.js";
import { Player } from "./player.js";
import { Loadout } from "./loadout.js";
import { FloatingText } from "./floatingText.js";
import { DevEditor } from "./devEditor.js";
import { Menu } from "./menu.js";
import { NetPlayers } from "./net.js";
import { GameAudio } from "./audio.js";
import { MapEditor } from "./mapEditor.js";
import { AuthScreen } from "./authScreen.js";
import { getCurrentUser, usernameFromUser, logout, isDevUser } from "./auth.js";

const audio = new GameAudio();

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
  deathScreen: document.getElementById("death-screen"),
  dsBy: document.getElementById("ds-by"),
  dsCount: document.getElementById("ds-count"),
  spawnProtect: document.getElementById("spawn-protect"),
  killPopup: document.getElementById("kill-popup"),
};
let score = 0;
let deaths = 0;
let hitmarkerTimer = 0;

// Match-feel state.
const SPAWN_PROTECT = 2.0; // seconds of invulnerability after spawning
const RESPAWN_DELAY = 2.5; // seconds dead before respawn
let dead = false;
let respawnTimer = 0;
let protectTimer = 0;

function flashHitmarker(isKill = false) {
  ui.hitmarker.classList.toggle("kill", isKill);
  ui.hitmarker.style.opacity = "1";
  hitmarkerTimer = isKill ? 0.2 : 0.12;
}

function showKillPopup(name) {
  ui.killPopup.textContent = `ELIMINATED ${name}`;
  ui.killPopup.style.opacity = "1";
  clearTimeout(showKillPopup._t);
  showKillPopup._t = setTimeout(() => (ui.killPopup.style.opacity = "0"), 1200);
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

// Custom-map spawns override the default arena spawns when a map provides them.
function currentSpawns() {
  if (mapSpawns && mapSpawns.length) return mapSpawns;
  return SPAWNS.map(([x, z]) => ({ x, y: 0, z, yaw: 0 }));
}

function respawn() {
  const list = currentSpawns();
  const s = list[Math.floor(Math.random() * list.length)];
  player.pos.set(s.x, s.y || 0, s.z);
  player.velY = 0;
  player.onGround = true;
  player.health = 100;
  if (typeof s.yaw === "number") player.yaw = s.yaw;
}

// We took damage from another player (their client reported the hit).
function takeDamage({ damage, from, fromName }) {
  if (!started || dead || protectTimer > 0) return; // ignore while protected/dead
  player.health -= damage;
  showDamageFlash();
  audio.hurt();
  if (player.health <= 0) die(from, fromName);
}

function die(killerId, killerName) {
  dead = true;
  respawnTimer = RESPAWN_DELAY;
  deaths++;
  ui.deaths.textContent = String(deaths);
  addKillFeed(killerName || "Someone", playerName);
  net.sendDeath(killerId, killerName);
  audio.death();

  ui.dsBy.textContent = `by ${killerName || "Someone"}`;
  ui.deathScreen.style.display = "flex";
}

function doRespawn() {
  dead = false;
  respawn();
  protectTimer = SPAWN_PROTECT;
  ui.deathScreen.style.display = "none";
  ui.spawnProtect.style.display = "block";
}

// Someone died (we may be the killer, victim, or a spectator).
function onKillEvent(p) {
  addKillFeed(p.killerName || "Someone", p.victimName || "Player");
  if (net && p.killer === net.localId && p.victim !== net.localId) {
    score++;
    ui.score.textContent = String(score);
    audio.kill();
    showKillPopup(p.victimName || "Player");
    flashHitmarker(true);
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
let mapHandle = null;
let mapSpawns = null;

initInput(canvas, document.getElementById("lock-overlay"));

// Dev map builder — created lazily, only for dev users (see enterMenu).
let mapEditor = null;
// Whether the signed-in user has dev tooling (map editor + viewmodel editor).
let devTools = false;

const menu = new Menu({
  onOpenMapEditor: () => {
    if (!mapEditor) return;
    menu.hide();
    mapEditor.open();
  },
  onLogout: () => signOut(),
  async onDeploy(slots, joinedLobby, mapName, character) {
    lobby = joinedLobby;
    playerName = (lobby && lobby.playerName) || "Player";

    // Custom map = clean baseplate + its structures; default = the arena.
    if (mapName) {
      setArenaDecor(world, false);
      try {
        const res = await fetch(`/maps/${mapName}.json`);
        const data = await res.json();
        mapHandle = await loadMapStructures(scene, world, data);
        mapSpawns = data.spawns && data.spawns.length ? data.spawns : null;
      } catch (e) {
        console.warn("[Yasu3D] failed to load map", mapName, e.message);
      }
    } else {
      setArenaDecor(world, true);
      mapSpawns = null;
    }
    loadout = new Loadout(scene, camera, slots);
    net = new NetPlayers(scene, camera, lobby);
    net.localName = playerName;
    net.localChar = character || "recruit";
    net.onDamaged = takeDamage;
    net.onKill = onKillEvent;
    net.onRemoteShot = (s) => {
      const d = camera.position.distanceTo(new THREE.Vector3(s.sx, s.sy, s.sz));
      audio.shoot("rifle", Math.max(0.12, 1 - d / 60)); // quieter with distance
    };

    audio.init();
    audio.resume();

    started = true;
    dead = false;
    respawn(); // position the player at a spawn point
    protectTimer = SPAWN_PROTECT;
    ui.spawnProtect.style.display = "block";
    document.body.classList.add("playing");
    document.getElementById("lock-overlay").classList.remove("hidden");
    refreshWeaponHud();

    if (devTools && !devEditor) {
      devEditor = new DevEditor(
        () => (loadout ? { weapon: loadout.current, key: loadout.currentKey } : null),
        camera,
        canvas
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Auth gate — you must be signed in before the menu is reachable.
// ---------------------------------------------------------------------------
menu.hide(); // stay hidden until we know there's a session

const authScreen = new AuthScreen({
  onAuthed: (username) => enterMenu(username),
});

function enterMenu(username) {
  authScreen.hide();
  menu.setPlayer(username);
  menu.loadSavedLoadout(); // restore the account's saved weapons

  // Dev tooling (map editor + viewmodel editor) is restricted to dev users.
  devTools = isDevUser(username);
  menu.canEditMaps = devTools;
  const devHint = document.getElementById("dev-hint");
  if (devHint) devHint.style.display = devTools ? "block" : "none";
  if (menu.canEditMaps && !mapEditor) {
    mapEditor = new MapEditor(scene, camera, renderer, world, {
      onExit: () => {
        camera.position.set(0, 6, 30);
        camera.lookAt(0, 1, 0);
        menu.show();
      },
    });
  }

  menu.showMain();
  menu.show();
}

async function signOut() {
  if (started) leaveMatch();
  try {
    await logout();
  } catch (e) {
    console.warn("[Yasu3D] sign-out failed", e.message);
  }
  menu.hide();
  authScreen.show();
}

// Resume an existing session if there is one, otherwise prompt for login.
(async () => {
  const user = await getCurrentUser();
  if (user) enterMenu(usernameFromUser(user));
  else authScreen.show();
})();

// Tear down the current match and return to the menu.
function leaveMatch() {
  if (!started) return;
  started = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (devEditor && devEditor.active) devEditor.toggle(false);

  if (loadout) loadout.dispose();
  if (net) net.dispose();
  if (mapHandle) {
    unloadMapStructures(scene, world, mapHandle);
    mapHandle = null;
  }
  setArenaDecor(world, true); // restore arena for the menu backdrop
  mapSpawns = null;
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

  dead = false;
  respawnTimer = 0;
  protectTimer = 0;
  ui.deathScreen.style.display = "none";
  ui.spawnProtect.style.display = "none";
  ui.killPopup.style.opacity = "0";

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

  // Map editor takes over the camera/scene when open.
  if (mapEditor && mapEditor.active) {
    mapEditor.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

  const mouse = consumeMouse();

  if (started && isLocked()) {
    if (!dead) {
      player.update(dt, mouse, world.colliders, world.meshColliders);

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
          audio.hit();
          if (info.killed) {
            const killPos = info.point.clone();
            killPos.y += 0.6;
            fx.spawn(killPos, "KILL", { color: "#3fb950", size: 24, life: 1.2, rise: 1.0 });
            score++;
            ui.score.textContent = String(score);
          }
        });
        if (shot) {
          audio.shoot(weapon.cfg.name);
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
            audio.hit();
            net.flashRemote(ph.id);
            net.sendHit(ph.id, ph.damage, ph.headshot);
          }
          net.broadcastShot(shot); // let other players see the tracer
        }
      }
      if (reloadHeld) weapon.reload();
      if (weapon.reloading > 0 && !weapon._wasReloading) audio.reload();
      weapon._wasReloading = weapon.reloading > 0;
    }

    net.sendLocal(player, playerName, dt); // broadcast our position (frozen if dead)
  }

  if (loadout) loadout.update(dt);
  if (net) net.update(dt);
  updateTargets(world.targets, dt);
  fx.update(dt);

  // Match-feel timers
  if (started) {
    if (dead) {
      respawnTimer -= dt;
      ui.dsCount.textContent = String(Math.max(0, Math.ceil(respawnTimer)));
      if (respawnTimer <= 0) doRespawn();
    }
    if (protectTimer > 0) {
      protectTimer -= dt;
      if (protectTimer <= 0) ui.spawnProtect.style.display = "none";
    }
  }

  // HUD
  if (started) {
    const weapon = loadout.current;
    ui.ammo.textContent = String(weapon.ammo);
    ui.reserve.textContent = String(weapon.reserve);
    ui.reloading.style.visibility = weapon.reloading > 0 ? "visible" : "hidden";
    ui.health.style.width = `${Math.max(0, player.health)}%`;
    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt;
      if (hitmarkerTimer <= 0) ui.hitmarker.style.opacity = "0";
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
