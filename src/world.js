import * as THREE from "three";
import { loadModel } from "./assets.js";

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

  // ---- Default-arena decorations (walls/crates/pillars/targets) ----
  // These live in a group that can be hidden so a custom map starts blank.
  const decor = new THREE.Group();
  scene.add(decor);
  const decorColliders = [];
  const decorSolids = [];

  const boxMat = new THREE.MeshStandardMaterial({ color: 0x3a4658, roughness: 0.85 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5435, roughness: 0.8 });

  function addBox(x, y, z, w, h, d, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    decor.add(mesh);
    solids.push(mesh);
    decorSolids.push(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    colliders.push(box);
    decorColliders.push(box);
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
    targets.push(makeTarget(decor, decorSolids, x, z));
  }
  for (const t of targets) solids.push(...t.parts);

  return {
    colliders,        // AABB box colliders (default arena)
    meshColliders: [], // actual meshes for raycast collision (imported maps)
    targets,
    solids,
    arena: ARENA,
    ground,
    decor,
    decorColliders,
    decorSolids,
    decorVisible: true,
  };
}

// Show/hide the default-arena decorations (walls/crates/pillars/targets).
// When hidden, their colliders + raycast meshes are pulled out so the player
// can move/shoot freely on a clean baseplate (used for custom maps + New map).
export function setArenaDecor(world, visible) {
  if (world.decorVisible === visible) return;
  world.decorVisible = visible;
  world.decor.visible = visible;

  if (visible) {
    for (const c of world.decorColliders) if (!world.colliders.includes(c)) world.colliders.push(c);
    for (const m of world.decorSolids) if (!world.solids.includes(m)) world.solids.push(m);
  } else {
    world.colliders = world.colliders.filter((c) => !world.decorColliders.includes(c));
    world.solids = world.solids.filter((m) => !world.decorSolids.includes(m));
  }
}

// Loads a saved map's structures into the scene and appends colliders/solids
// to the existing world. Returns a handle so they can be removed later.
//   mapData: { objects: [{ model, position[3], rotation[3], scale[3] }] }
export async function loadMapStructures(scene, world, mapData) {
  const nodes = [];
  const meshColliders = [];
  const solids = [];

  for (const o of mapData.objects || []) {
    let node;
    try {
      node = (await loadModel(o.model)).scene;
    } catch (e) {
      console.warn("[Yasu3D] map: failed to load", o.model, e.message);
      continue;
    }
    const p = o.position || [0, 0, 0];
    const r = o.rotation || [0, 0, 0];
    const s = o.scale || [1, 1, 1];
    node.position.set(p[0], p[1], p[2]);
    node.rotation.set(r[0], r[1], r[2]);
    node.scale.set(s[0], s[1], s[2]);
    if (o.color) {
      node.traverse((n) => {
        if (!n.isMesh) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach((m) => m.color && m.color.set(o.color));
      });
    }
    node.updateMatrixWorld(true);
    scene.add(node);
    nodes.push(node);

    // Use the real meshes for collision (raycast) + bullet occlusion, so you
    // can walk on actual surfaces instead of a giant bounding box.
    node.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        world.solids.push(n);
        solids.push(n);
        world.meshColliders.push(n);
        meshColliders.push(n);
      }
    });
  }

  return { nodes, meshColliders, solids };
}

// Removes a previously-loaded map (its nodes + the colliders/solids it added).
export function unloadMapStructures(scene, world, handle) {
  if (!handle) return;
  for (const node of handle.nodes) scene.remove(node);
  world.meshColliders = world.meshColliders.filter((m) => !handle.meshColliders.includes(m));
  world.solids = world.solids.filter((m) => !handle.solids.includes(m));
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

function makeTarget(parent, decorSolids, x, z) {
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
  parent.add(group);

  // Each child mesh needs a back-reference so the raycast can find the target,
  // plus which body part was hit (for headshot bonus damage).
  const target = {
    mesh: group,
    mat,
    parts: [body, head],
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
  decorSolids.push(body, head);
  return target;
}
