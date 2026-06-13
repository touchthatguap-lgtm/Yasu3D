import { Weapon } from "./weapon.js";
import { WEAPONS } from "./weapons.js";

// Holds the player's equipped weapons and the currently-drawn one.
// slots: { primary: "rifle", secondary: "pistol" }
export class Loadout {
  constructor(scene, camera, slots) {
    this.scene = scene;
    this.camera = camera;
    this.slots = slots;
    this.weapons = {
      primary: new Weapon(scene, camera, WEAPONS[slots.primary]),
      secondary: new Weapon(scene, camera, WEAPONS[slots.secondary]),
    };
    this.active = "primary";
    this._updateVisibility();
  }

  get current() {
    return this.weapons[this.active];
  }

  // The weapons.js key of the active gun (e.g. "rifle") — used by the dev editor.
  get currentKey() {
    return this.slots[this.active];
  }

  switchTo(slot) {
    if (!this.weapons[slot] || slot === this.active) return false;
    this.active = slot;
    this._updateVisibility();
    return true;
  }

  toggle() {
    return this.switchTo(this.active === "primary" ? "secondary" : "primary");
  }

  _updateVisibility() {
    for (const key in this.weapons) {
      const w = this.weapons[key];
      w.gun.visible = key === this.active;
    }
  }

  update(dt) {
    // Update both so tracers/flash decay even right after a swap.
    this.weapons.primary.update(dt);
    this.weapons.secondary.update(dt);
  }

  dispose() {
    this.weapons.primary.dispose();
    this.weapons.secondary.dispose();
  }
}
