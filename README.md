# Portal Clone

A small first-person puzzle game for the browser, inspired by Valve's *Portal*. You carry a device that fires two linked portals, and you use them to get a weighted cube onto a button to open the exit.

This is a proof of concept with one level, **Test Chamber 01**.

**Play:** https://matthewcastellano99-creator.github.io/portal_clone/ (desktop browser with a mouse; WebGL 2 required)

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look |
| W A S D / arrow keys | Move |
| Space | Jump |
| Left click | Fire blue portal |
| Right click | Fire orange portal |
| E (or F) | Pick up / drop the cube |
| R | Restart the chamber |
| Esc | Pause |

Portals only stick to the **white panels**. Dark metal, the door and the cube stop a shot.

## Features

- See-through portals with recursive views (a portal can show itself inside itself).
- Momentum is kept through portals, so falling into a floor portal flings you out of a wall portal.
- Carry the cube through portals, or grab it through one.
- Floor button, sliding exit door and indicator lights.
- You can see your own body through portals, and it casts a shadow.
- Everything is generated in code: textures, models and sound effects. There are no asset files.

## Running locally

There is no build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
npx http-server -c-1 .        # or: python3 -m http.server
```

Then open `http://localhost:8080` (or whichever port the server prints).

URL options:

- `?quality=low`: lower resolution, no multisampling and 2 levels of portal recursion, for weaker GPUs.
- `?debug`: show an FPS and portal-render counter.

## Tests

`tests/playthrough.mjs` loads the game in headless Chromium and solves the chamber through the game's own simulation: it places portals, walks through them, carries the cube, presses the button and exits. It fails on any page error.

```sh
npm install
npx playwright install chromium   # first time only
npm test
```

## How it works

| File | Purpose |
| --- | --- |
| `src/main.js` | Game setup, fixed-step loop, input, cube carrying, UI |
| `src/level.js` | Test Chamber 01 layout (axis-aligned boxes) and decoration |
| `src/physics.js` | Box-vs-box collision, portal-aware collision and raycasts |
| `src/portals.js` | Portal placement and fitting, portal surface shader, teleporting |
| `src/portalRenderer.js` | Renders the view through each portal, with recursion |
| `src/player.js` | First-person movement (Source-style acceleration and friction) |
| `src/cube.js`, `src/entities.js` | Weighted cube, floor button, door, indicator lights |
| `src/gun.js`, `src/avatar.js` | First-person portal device and the third-person body |
| `src/textures.js`, `src/materials.js` | Procedural panel, metal and floor textures |
| `src/audio.js` | Synthesised sound effects (WebAudio) |

**Rendering.** For each portal, the scene is rendered from a virtual camera behind the other portal into a screen-sized texture. The portal's oval surface then samples that texture at its own screen position, so the view lines up exactly. A clipping plane at the exit portal hides anything between the virtual camera and the exit. If the portal is visible again inside its own view, the camera is pushed through once more. Up to 4 levels are drawn, deepest first, and each level is scissored to the portal's on-screen bounds.

**Physics.** The world and everything in it are axis-aligned boxes. When a body is lined up with a linked portal and touching its surface, the level's collision is clipped to the half-space in front of the portal. Walls around the hole are added behind it, which lets you walk into the wall only through the portal opening. When the body's reference point (the eye for the player, the centre for the cube) crosses the portal plane, position, velocity and view direction are mapped to the other portal.

**Placement.** A shot that lands on a white surface is nudged up to 1.3 m to find a spot where the whole portal fits on portalable panels, with nothing in front and no overlap with the other portal. Wall portals shot just above a floor slide down to rest on it.

## Credits

A fan-made tribute that isn't affiliated with or endorsed by Valve. *Portal* is a trademark of Valve Corporation. Built with [three.js](https://threejs.org) (MIT, vendored in `vendor/three`).
