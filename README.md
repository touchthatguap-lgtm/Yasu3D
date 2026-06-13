# Yasu3D

A 3D browser game built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/).

## Play

A blue cube explores a neon arena. Move around, jump, and collect all the gold coins.

| Action | Keys |
| ------ | ---- |
| Move   | `W` `A` `S` `D` or arrow keys |
| Jump   | `Space` |

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Project layout

```
index.html      # canvas + HUD
src/main.js      # scene, player, coins, game loop
```

## License

MIT
