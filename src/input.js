// Keyboard + mouse input with pointer-lock handling.

export const keys = new Set();

// Accumulated mouse movement since the last consume(), plus button state.
const mouse = { dx: 0, dy: 0, left: false, leftEdge: false };

let locked = false;
const lockListeners = [];

export function initInput(canvas, overlay) {
  // --- Keyboard ---
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  // Dropping all keys when the window loses focus avoids "stuck" movement.
  window.addEventListener("blur", () => keys.clear());

  // --- Pointer lock ---
  overlay.addEventListener("click", () => canvas.requestPointerLock());

  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    overlay.classList.toggle("hidden", locked);
    if (!locked) keys.clear();
    lockListeners.forEach((fn) => fn(locked));
  });

  // --- Mouse ---
  document.addEventListener("mousemove", (e) => {
    if (!locked) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  });
  document.addEventListener("mousedown", (e) => {
    if (!locked || e.button !== 0) return;
    if (!mouse.left) mouse.leftEdge = true; // rising edge for semi-auto feel
    mouse.left = true;
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.left = false;
  });
}

export function isLocked() {
  return locked;
}

export function onLockChange(fn) {
  lockListeners.push(fn);
}

// Returns accumulated look delta and resets it. Call once per frame.
export function consumeMouse() {
  const out = { dx: mouse.dx, dy: mouse.dy, left: mouse.left, leftEdge: mouse.leftEdge };
  mouse.dx = 0;
  mouse.dy = 0;
  mouse.leftEdge = false;
  return out;
}
