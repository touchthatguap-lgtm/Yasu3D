import * as THREE from "three";

// Builds the arena and returns:
//   colliders  : THREE.Box3[]   -> solid AABBs the player collides with
//   targets    : { mesh, box, alive, respawnAt }[]  -> shootable dummies
//   solids     : THREE.Mesh[]   -> meshes the bullet raycast can hit (for occlusion)
export function buildWorld(scene) {
  const colliders = [];
  const solids = [];
  const targets = [];

  // ---- Lighting ----
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1f29, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  const s = 70;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  scene.add(sun);

  scene.background = new THREE.Color(0x141a24);
  scene.fog = new THREE.Fog(0x141a24, 60, 140);

  // ---- Ground ----
  const ARENA = 80;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA, ARENA),
    new THREE.MeshStandardMaterial({ color: 0x202b3a, roughness: 0.97 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  solids.push(ground);

  const grid = new THREE.GridHelper(ARENA, ARENA / 2, 0x2f465c, 0x26323f);
  grid.position.y = 0.02;
  scene.add(grid);

  // ---- Helper to add a solid box (wall / crate) ----
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x3a4658, roughness: 0.85 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5435, roughness: 0.8 });

  function addBox(x, y, z, w, h, d, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    colliders.push(box);
    return mesh;
  }

  // ---- Perimeter walls ----
  const H = 6;
  const half = ARENA / 2;
  addBox(0, H / 2, -half, ARENA, H, 2, boxMat); // north
  addBox(0, H / 2, half, ARENA, H, 2, boxMat); // south
  addBox(-half, H / 2, 0, 2, H, ARENA, boxMat); // west
  addBox(half, H / 2, 0, 2, H, ARENA, boxMat); // east

  // ---- Cover / crates (also jumpable) ----
  const layout = [
    [0, -12, 4, 4], [0, 12, 4, 4],
    [-16, 0, 3, 3], [16, 0, 3, 3],
    [-10, -20, 2.5, 2.5], [10, 20, 2.5, 2.5],
    [-22, 16, 3, 5], [22, -16, 3, 5],
    [8, -6, 2, 2], [-8, 6, 2, 2],
  ];
  for (const [x, z, w, h] of layout) {
    addBox(x, h / 2, z, w, h, w, crateMat);
  }

  // A couple of taller pillars for verticality.
  addBox(-28, 4, -28, 4, 8, 4, boxMat);
  addBox(28, 4, 28, 4, 8, 4, boxMat);

  // ---- Targets ----
  const spawnPoints = [
    [-20, -10], [20, -10], [-20, 10], [20, 10],
    [0, -28], [0, 28], [-30, 0], [30, 0],
  ];
  for (const [x, z] of spawnPoints) {
    targets.push(makeTarget(scene, solids, x, z));
  }

  return { colliders, targets, solids, arena: ARENA };
}

// Per-frame target upkeep: hit-flash decay + respawn. Called once from main
// (not per-weapon, so it isn't double-stepped when you carry two guns).
export function updateTargets(targets, dt) {
  for (const target of targets) {
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

const TARGET_HEIGHT = 1.8;

function makeTarget(scene, solids, x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff8c1a,
    emissive: 0x612f00,
    roughness: 0.5,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 6, 12), mat);
  body.position.y = TARGET_HEIGHT / 2;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat);
  head.position.y = TARGET_HEIGHT - 0.1;
  head.castShadow = true;
  group.add(body, head);
  group.position.set(x, 0, z);
  scene.add(group);

  // Each child mesh needs a back-reference so the raycast can find the target,
  // plus which body part was hit (for headshot bonus damage).
  const target = {
    mesh: group,
    mat,
    alive: true,
    respawnAt: 0,
    base: [x, z],
    health: 100,
    maxHealth: 100,
    flash: 0, // brief white flash on hit, decayed in weapon.update
  };
  body.userData.target = target;
  body.userData.part = "body";
  head.userData.target = target;
  head.userData.part = "head";
  solids.push(body, head);
  return target;
}
