import * as THREE from "three";

// Procedural low-poly guns built from primitives — used when there's no model
// file yet. Built barrel-forward (-Z) with the longest axis along Z so the
// weapon auto-orient logic leaves them as-is. Swap for a real .glb anytime by
// giving the weapon a `model` URL instead of `build`.

export function buildPistol() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.4 });

  const add = (geo, mat, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // Slide / body (long axis = Z, pointing forward -Z)
  add(new THREE.BoxGeometry(0.5, 0.45, 1.8), metal, [0, 0.2, 0]);
  // Barrel tip block
  add(new THREE.BoxGeometry(0.4, 0.32, 0.5), dark, [0, 0.22, -1.0]);
  // Grip, angled back
  add(new THREE.BoxGeometry(0.42, 1.0, 0.55), dark, [0, -0.45, 0.55], [0.3, 0, 0]);
  // Trigger guard hint
  add(new THREE.BoxGeometry(0.2, 0.4, 0.1), metal, [0, -0.15, 0.2]);

  return g;
}
