import * as THREE from "three";

// Character registry. A character is the avatar other players see for you.
// Add a custom one by dropping a model in public/models/characters/ and adding
// an entry with its `model` path (see the commented example below).
//
// Hit detection uses a separate invisible hitbox (in net.js), so gameplay is
// identical no matter which character model is selected — the model is purely
// cosmetic.

export const DEFAULT_CHARACTER = "recruit";

export const CHARACTERS = {
  recruit: {
    name: "recruit",
    displayName: "Recruit",
    build: buildRecruit, // procedural — no model file needed
  },

  banana: {
    name: "banana",
    displayName: "Cool Bannana Guy",
    model: "/models/characters/CoolBannanaGuy.glb",
    height: 1.9, // scaled to stand this many units tall (matches the hitbox)
    faceFix: 0, // extra Y-rotation (radians) if the model faces the wrong way
  },
};

export function characterList() {
  return Object.values(CHARACTERS);
}

// The built-in default avatar: a simple capsule body + head with a nose so you
// can read which way they're facing (forward = -Z).
function buildRecruit(color = 0xff5252) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), mat);
  body.position.y = 0.9;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat);
  head.position.y = 1.7;
  head.castShadow = true;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  nose.position.set(0, 1.7, -0.32);
  g.add(body, head, nose);
  return g;
}
