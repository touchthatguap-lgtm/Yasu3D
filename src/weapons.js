// Weapon definitions. Add a new gun by dropping a model in public/models/guns/
// (or a procedural builder) and adding an entry here — loading, scaling, firing,
// and the loadout UI are all generic.

import overrides from "./weapon-overrides.json";

export const WEAPONS = {
  rifle: {
    name: "rifle",
    displayName: "Assault Rifle",
    slot: "primary",
    model: "/models/guns/assault-rifle.glb",

    automatic: true,
    magSize: 30,
    reserve: 90,
    fireCooldown: 0.1,
    reloadTime: 1.6,
    bodyDamage: 34,
    headDamage: 100,

    viewmodel: {
      length: 0.72,
      position: [0.28, -0.24, -0.42],
      extraRotation: [0, 0, 0],
      flip: false,
      muzzleOffset: [0.08, 0, 0],
    },
  },

  pistol: {
    name: "pistol",
    displayName: "Pistol",
    slot: "secondary",
    model: "/models/guns/pistol.glb",

    automatic: false, // semi-auto: one shot per click
    magSize: 12,
    reserve: 48,
    fireCooldown: 0.16,
    reloadTime: 1.1,
    bodyDamage: 26,
    headDamage: 100,

    viewmodel: {
      length: 0.4,
      position: [0.26, -0.22, -0.4],
      extraRotation: [0, 0, 0],
      flip: false,
      muzzleOffset: [0, 0, 0],
    },
  },
};

// Merge any values saved from the in-game dev editor (src/weapon-overrides.json).
for (const key in WEAPONS) {
  const ov = overrides[key];
  if (ov && ov.viewmodel) Object.assign(WEAPONS[key].viewmodel, ov.viewmodel);
}

export function weaponsForSlot(slot) {
  return Object.values(WEAPONS).filter((w) => w.slot === slot);
}
