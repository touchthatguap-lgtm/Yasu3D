import * as THREE from "three";
import { keys } from "./input.js";

const EYE_HEIGHT = 1.7;
const RADIUS = 0.35;
const WALK_SPEED = 7;
const SPRINT_SPEED = 11;
const JUMP_VELOCITY = 7.5;
const GRAVITY = -22;
const MOUSE_SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

export class Player {
  constructor(camera, spawn = [0, 0]) {
    this.camera = camera;
    // Feet position (y = 0 is standing on the ground plane).
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.velY = 0;
    this.onGround = true;
    this.yaw = 0;   // left/right, radians
    this.pitch = 0; // up/down, radians
    this.health = 100;
  }

  // mouse: { dx, dy } accumulated this frame.
  update(dt, mouse, colliders) {
    // --- Look ---
    this.yaw -= mouse.dx * MOUSE_SENS;
    this.pitch -= mouse.dy * MOUSE_SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -MAX_PITCH, MAX_PITCH);

    // --- Movement input relative to yaw ---
    let fwd = 0;
    let strafe = 0;
    if (keys.has("KeyW")) fwd += 1;
    if (keys.has("KeyS")) fwd -= 1;
    if (keys.has("KeyD")) strafe += 1;
    if (keys.has("KeyA")) strafe -= 1;

    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? SPRINT_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is -Z when yaw = 0.
    let dx = (-sin * fwd + cos * strafe);
    let dz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx = (dx / len) * speed * dt;
      dz = (dz / len) * speed * dt;
    }

    // --- Horizontal move + collision (resolve each axis so we slide along walls) ---
    this.pos.x += dx;
    this._resolveHorizontal(colliders, "x");
    this.pos.z += dz;
    this._resolveHorizontal(colliders, "z");

    // --- Jump + gravity ---
    if (keys.has("Space") && this.onGround) {
      this.velY = JUMP_VELOCITY;
      this.onGround = false;
    }
    this.velY += GRAVITY * dt;
    this.pos.y += this.velY * dt;
    this._resolveVertical(colliders);

    // --- Apply to camera ---
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  // Push the player out of any box it overlaps on the given axis (XZ circle vs AABB).
  _resolveHorizontal(colliders, axis) {
    const feet = this.pos.y;
    const head = this.pos.y + EYE_HEIGHT;
    for (const box of colliders) {
      // Only collide if our vertical span overlaps the box's.
      if (head <= box.min.y || feet >= box.max.y) continue;
      // Closest point on the box (in XZ) to the player center.
      const cx = THREE.MathUtils.clamp(this.pos.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(this.pos.z, box.min.z, box.max.z);
      const ox = this.pos.x - cx;
      const oz = this.pos.z - cz;
      const distSq = ox * ox + oz * oz;
      if (distSq >= RADIUS * RADIUS) continue; // not penetrating

      const dist = Math.sqrt(distSq) || 0.0001;
      const push = RADIUS - dist;
      if (axis === "x") this.pos.x += (ox / dist) * push;
      else this.pos.z += (oz / dist) * push;
    }
  }

  // Resolve landing on the ground plane or on top of boxes; bonk head on ceilings.
  _resolveVertical(colliders) {
    let groundY = 0; // base ground plane

    for (const box of colliders) {
      // Is the player horizontally over this box (within radius)?
      const cx = THREE.MathUtils.clamp(this.pos.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(this.pos.z, box.min.z, box.max.z);
      const overXZ =
        (this.pos.x - cx) ** 2 + (this.pos.z - cz) ** 2 < RADIUS * RADIUS;
      if (!overXZ) continue;

      // Landing on top: only when falling and feet are at/under the box top
      // but not far below it.
      if (this.velY <= 0 && this.pos.y <= box.max.y + 0.05 && this.pos.y >= box.min.y) {
        groundY = Math.max(groundY, box.max.y);
      }

      // Head bonk: rising into the underside of a box.
      const head = this.pos.y + EYE_HEIGHT;
      if (this.velY > 0 && head > box.min.y && this.pos.y < box.min.y) {
        this.pos.y = box.min.y - EYE_HEIGHT;
        this.velY = 0;
      }
    }

    if (this.pos.y <= groundY) {
      this.pos.y = groundY;
      this.velY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }
}

export { EYE_HEIGHT };
