import * as THREE from "three";
import { initInput, consumeMouse, isLocked } from "./input.js";
import { buildWorld } from "./world.js";
import { Player } from "./player.js";
import { Weapon } from "./weapon.js";
import { FloatingText } from "./floatingText.js";

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
scene.add(camera); // camera holds the gun viewmodel, so it must be in the scene

// ---------------------------------------------------------------------------
// World, player, weapon
// ---------------------------------------------------------------------------
const world = buildWorld(scene);
const player = new Player(camera, [0, 25]);
const weapon = new Weapon(scene, camera);
const fx = new FloatingText(camera);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const ui = {
  score: document.getElementById("score"),
  ammo: document.getElementById("ammo"),
  reserve: document.getElementById("reserve"),
  reloading: document.getElementById("reloading"),
  health: document.getElementById("health-bar"),
  hitmarker: document.getElementById("hitmarker"),
};
let score = 0;
let hitmarkerTimer = 0;

function flashHitmarker() {
  ui.hitmarker.style.opacity = "1";
  hitmarkerTimer = 0.12;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
initInput(canvas, document.getElementById("lock-overlay"));

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

  if (isLocked()) {
    player.update(dt, mouse, world.colliders);

    // Auto-fire while holding the mouse (weapon enforces its own cooldown).
    if (mouse.left) {
      const hit = weapon.tryShoot(world.targets, world.solids, (info) => {
        // Floating damage number at the hit point.
        if (info.headshot) {
          fx.spawn(info.point, `${info.damage} HEADSHOT`, { color: "#ffd54a", size: 26, life: 1.1 });
        } else {
          fx.spawn(info.point, String(info.damage), { color: "#ff6b6b", size: 22 });
        }
        if (info.killed) {
          // Pop a KILL tag slightly above the hit.
          const killPos = info.point.clone();
          killPos.y += 0.6;
          fx.spawn(killPos, "KILL", { color: "#3fb950", size: 24, life: 1.2, rise: 1.0 });
          score++;
          ui.score.textContent = String(score);
        }
      });
      if (hit) flashHitmarker();
    }
    if (mouseReload) weapon.reload();
  }

  weapon.update(dt, world.targets);
  fx.update(dt);

  // HUD
  ui.ammo.textContent = String(weapon.ammo);
  ui.reserve.textContent = String(weapon.reserve);
  ui.reloading.style.visibility = weapon.reloading > 0 ? "visible" : "hidden";
  ui.health.style.width = `${player.health}%`;

  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) ui.hitmarker.style.opacity = "0";
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Reload key (R) — tracked separately since it's an edge action.
let mouseReload = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") mouseReload = true;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "KeyR") mouseReload = false;
});

frame();
