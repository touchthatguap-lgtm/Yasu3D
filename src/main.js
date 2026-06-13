import * as THREE from "three";

// ---------------------------------------------------------------------------
// Renderer & scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 30, 80);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202830, 0.6));

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
const GROUND = 50;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND, GROUND),
  new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(GROUND, GROUND, 0x30425c, 0x222d3d);
grid.position.y = 0.01;
scene.add(grid);

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x4c9aff, roughness: 0.4, metalness: 0.1 })
);
player.position.set(0, 0.5, 0);
player.castShadow = true;
scene.add(player);

const PLAYER_SPEED = 9;
const JUMP_VELOCITY = 8;
const GRAVITY = -22;
let velocityY = 0;
let onGround = true;

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------
const COIN_COUNT = 12;
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.12, 24);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffd54a,
  roughness: 0.3,
  metalness: 0.7,
  emissive: 0x3a2c00,
});

// Deterministic-ish scatter so coins never overlap the spawn point.
for (let i = 0; i < COIN_COUNT; i++) {
  const coin = new THREE.Mesh(coinGeo, coinMat);
  const angle = (i / COIN_COUNT) * Math.PI * 2;
  const radius = 6 + (i % 4) * 4;
  coin.position.set(Math.cos(angle) * radius, 0.8, Math.sin(angle) * radius);
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;
  scene.add(coin);
  coins.push(coin);
}

let score = 0;
const scoreEl = document.getElementById("score");
const totalEl = document.getElementById("total");
const winEl = document.getElementById("win");
totalEl.textContent = String(COIN_COUNT);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
]);
window.addEventListener("keydown", (e) => {
  if (MOVE_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

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
const half = GROUND / 2 - 0.5;

function update(dt) {
  // Horizontal movement
  let dx = 0;
  let dz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) dz -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) dz += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;

  if (dx !== 0 || dz !== 0) {
    const len = Math.hypot(dx, dz);
    player.position.x += (dx / len) * PLAYER_SPEED * dt;
    player.position.z += (dz / len) * PLAYER_SPEED * dt;
  }

  // Keep player on the field
  player.position.x = THREE.MathUtils.clamp(player.position.x, -half, half);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -half, half);

  // Jump + gravity
  if (keys.has("Space") && onGround) {
    velocityY = JUMP_VELOCITY;
    onGround = false;
  }
  velocityY += GRAVITY * dt;
  player.position.y += velocityY * dt;
  if (player.position.y <= 0.5) {
    player.position.y = 0.5;
    velocityY = 0;
    onGround = true;
  }

  // Coins spin + collection
  for (const coin of coins) {
    if (!coin.visible) continue;
    coin.rotation.z += dt * 3;
    const dxC = coin.position.x - player.position.x;
    const dzC = coin.position.z - player.position.z;
    if (dxC * dxC + dzC * dzC < 1.0) {
      coin.visible = false;
      score++;
      scoreEl.textContent = String(score);
      if (score === COIN_COUNT) winEl.textContent = "All coins collected! 🎉";
    }
  }

  // Chase camera
  const camTarget = new THREE.Vector3(
    player.position.x,
    player.position.y + 6,
    player.position.z + 11
  );
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
  camera.lookAt(player.position.x, player.position.y + 0.5, player.position.z);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
