# Portal Clone

A small first-person puzzle game for the browser, inspired by Valve's *Portal*. You carry a device that fires two linked portals, and you use them to get a weighted cube onto a button to open the exit.

There are three levels, joined by elevator rides:

- **Level 01:** the basics. The cube is up on a ledge and the button is up on a platform; portals only stick to white panels.
- **Level 02:** moving things with gravity. The cube sits at the bottom of a pit you can't reach, and the button is in an alcove you can't climb into. Whatever falls into one portal falls out of the other.
- **Level 03:** the fling. A chasm separates you from the button, and nothing on the far side holds a portal. Fall far enough into one portal and you come flying out of the other. The cube has to make the trip too.

Pick any level from **Select level** on the start or pause menu. Levels you've finished are ticked (remembered in this browser). The pause menu also has **Restart level**.

**Skin** on the same menu switches between the orange-suited test subject with the portal device, and an Arbiter-style Sangheili in silver armour carrying a portal tool shaped like a plasma rifle. Your pick is remembered in this browser.

When the exit door opens, step into the glass elevator. It closes, rides up its shaft as the screen fades, shows the next level's card, and brings you down into the next level.

**Play:** https://matthewcastellano99-creator.github.io/portal_clone/

It runs in a desktop browser with a mouse and keyboard, or on a phone or tablet with on-screen controls. Phones work best held sideways. It needs WebGL 2 (iOS 16.4 or later, or a recent Chrome, Firefox or Edge).

## Controls

On a phone or tablet:

| Touch | Action |
| --- | --- |
| Left half of the screen | Move (the stick appears under your thumb) |
| Drag anywhere else | Look |
| Blue / orange buttons | Fire a portal (keep dragging to aim) |
| Grab | Pick up / drop the cube (it lights up when the cube is in reach) |
| Jump | Jump |
| Pause button (top left) | Pause |

With a mouse and keyboard:

| Input | Action |
| --- | --- |
| Mouse | Look |
| W A S D / arrow keys | Move |
| Space | Jump |
| Left click | Fire blue portal |
| Right click | Fire orange portal |
| E (or F) | Pick up / drop the cube |
| R | Restart the level |
| Esc | Pause |

If the browser won't lock the mouse pointer (some embedded views), drag to look and click without dragging to fire.

Portals only stick to the **white panels**. Dark metal, the door and the cube stop a shot.

## Features

- See-through portals with recursive views (a portal can show itself inside itself).
- Momentum is kept through portals, so falling into a floor portal flings you out of a wall portal. Fast exits come out straight along the portal, and a falling body that's roughly over a floor portal is steered into it, so flings are predictable.
- Carry the cube through portals, or grab it through one. Portal shots pass through the cube, so aiming at it puts a portal under it.
- Elevator transitions between levels, with a level card while the next one loads.
- Floor button, sliding exit door and indicator lights.
- You can see your own body through portals, and it casts a shadow.
- Everything is generated in code: textures, models, sound effects and the ambient music. There are no asset files.

## Running locally

There is no build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
npx http-server -c-1 .        # or: python3 -m http.server
```

Then open `http://localhost:8080` (or whichever port the server prints).

URL options:

- `?quality=low`: lower resolution, no multisampling and 2 levels of portal recursion, for weaker GPUs.
- `?quality=mobile` / `?quality=high`: force the phone or desktop settings. Phones and tablets pick `mobile` automatically, and the render resolution also adjusts itself while you play to keep the frame rate up.
- `?debug`: show an FPS and portal-render counter.

## Publishing

GitHub Pages serves the `gh-pages` branch. To update the live game after changing `main`:

```sh
git push origin main:gh-pages
```

## Tests

`tests/playthrough.mjs` loads the game in headless Chromium and plays both levels through the game's own simulation. It places portals, walks through them, carries the cube, rides the elevator to Level 02, drops the cube out of the pit and onto the alcove button, and finishes. It then throws the player and the cube through randomly placed portals in both levels and fails if anything ends up stuck inside geometry. It also fails on any page error.

```sh
npm install
npx playwright install chromium   # first time only
npm test
```

## How it works

| File | Purpose |
| --- | --- |
| `src/main.js` | Game setup, quality presets, fixed-step loop, input, cube carrying, UI |
| `src/touch.js` | On-screen touch controls |
| `src/levels.js` | The level layouts (axis-aligned boxes), their elevators, signs and lines |
| `src/level.js` | Builds a level's geometry from boxes, plus shared decoration (lamps, signs, windows) |
| `src/physics.js` | Box-vs-box collision, portal-aware collision and raycasts |
| `src/portals.js` | Portal placement and fitting, portal surface shader, teleporting |
| `src/portalRenderer.js` | Renders the view through each portal, with recursion |
| `src/player.js` | First-person movement (Source-style acceleration and friction) |
| `src/cube.js`, `src/entities.js` | Weighted cube, floor button, door, indicator lights, elevators |
| `src/gun.js`, `src/avatar.js` | First-person device and the third-person body, for each skin |
| `src/textures.js`, `src/materials.js` | Procedural panel, metal and floor textures |
| `src/audio.js` | Synthesised sound effects and generative ambient music (WebAudio) |

**Rendering.** For each portal, the scene is rendered from a virtual camera behind the other portal into a screen-sized texture. The portal's oval surface then samples that texture at its own screen position, so the view lines up exactly. A clipping plane at the exit portal hides anything between the virtual camera and the exit. If the portal is visible again inside its own view, the camera is pushed through once more. Up to 4 levels are drawn, deepest first, and each level is scissored to the portal's on-screen bounds.

**Physics.** The world and everything in it are axis-aligned boxes. When a body is lined up with a linked portal and touching its surface, the level's collision is clipped to the half-space in front of the portal. Walls around the hole are added behind it, which lets you walk into the wall only through the portal opening. When the body's reference point (the eye for the player, the centre for the cube) crosses the portal plane, position, velocity and view direction are mapped to the other portal.

**Placement.** A shot that lands on a white surface is nudged up to 1.3 m to find a spot where the whole portal fits on portalable panels, with nothing in front and no overlap with the other portal. Wall portals slide down the wall (up to 3 m) to rest on the floor below them, and walking into a wall portal whose bottom edge is up to 45 cm above your feet steps you up into it.

## Credits

A fan-made tribute that isn't affiliated with or endorsed by Valve. *Portal* is a trademark of Valve Corporation. Built with [three.js](https://threejs.org) (MIT, vendored in `vendor/three`).
