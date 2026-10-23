import { b, slab, lamps, stripLight, observationWindow, chamberSign, dispenser } from './level.js';

// Chamber layouts. Every level has one weighted cube, one floor button and
// one exit door the button opens. Elevators carry the player between levels:
// `arrival` is where the previous chamber's elevator delivers them (the first
// level uses `spawn` instead) and `exit` is the elevator out. Elevator
// positions are the centre of the car's floor; their yaw turns the doorway,
// which faces +z at 0, towards the room.

const TOTAL = 3;
const DOOR_OPEN_LINE = 'The exit is open. Step into the elevator.';

// Test Chamber 01
//
// The main room spans x -9..9, z -11..11 and is 10 m tall. The cube sits on a
// 4 m high ledge against the east wall. The button and the exit door are on a
// 4 m high platform in the north-west corner. Only a few surfaces are white
// (portalable): a strip of the west wall at ground level, the east wall above
// the ledge, the north wall above the platform, and a patch of floor.
const chamber01 = {
  number: 1,
  intro: 'Test Chamber 01. Bring the Weighted Cube to the button to open the exit.',
  doorOpen: DOOR_OPEN_LINE,
  card: ['Bring the cube to the button.', 'Some surfaces will not hold a portal.'],
  spawn: { pos: [0, 0, 8.5], yaw: 0 }, // feet position; yaw 0 faces -z (north)
  exit: { pos: [-14.6, 4, -8.5], yaw: Math.PI / 2 },
  cube: [6.6, 4.37, 3.5],
  button: [-3.2, 4, -8.5],
  door: { x: -9.5, y: 4, z: -8.5, width: 2, height: 2.6 },
  antline: [[-4.18, 4.05, -8.5], [-8.88, 4.05, -8.5]],
  fillLight: [-13.5, 6.5, -8.5],
  shadow: { x: -4, z: 0, half: 17 },
  killY: -25,
  boxes: [
    // floor, with a portalable patch in the middle
    b(-2, -1, 2, 2, 0, 6, 'whiteFloor'),
    b(-10, -1, -12, -2, 0, 12, 'floor'),
    b(2, -1, -12, 10, 0, 12, 'floor'),
    b(-2, -1, -12, 2, 0, 2, 'floor'),
    b(-2, -1, 6, 2, 0, 12, 'floor'),
    // ceiling
    b(-10, 10, -12, 10, 11, 12, 'metal', { castShadow: false }),
    // south wall
    b(-10, 0, 11, 10, 10, 12, 'metal'),
    // north wall, white above the exit platform
    b(-10, 0, -12, -7, 10, -11, 'metal'),
    b(-7, 0, -12, -3, 4, -11, 'metal'),
    b(-7, 4, -12, -3, 7.5, -11, 'white'),
    b(-7, 7.5, -12, -3, 10, -11, 'metal'),
    b(-3, 0, -12, 10, 10, -11, 'metal'),
    // west wall: exit doorway above the platform, white strip at ground level
    b(-10, 0, -12, -9, 10, -9.5, 'metal'),
    b(-10, 0, -9.5, -9, 4, -7.5, 'metal'),
    b(-10, 6.6, -9.5, -9, 10, -7.5, 'metal'),
    b(-10, 0, -7.5, -9, 10, -2, 'metal'),
    b(-10, 0, -2, -9, 4, 6, 'white'),
    b(-10, 4, -2, -9, 10, 6, 'metal'),
    b(-10, 0, 6, -9, 10, 12, 'metal'),
    // east wall, white above the cube ledge
    b(9, 0, -12, 10, 10, 1, 'metal'),
    b(9, 0, 1, 10, 4, 7, 'metal'),
    b(9, 4, 1, 10, 8, 7, 'white'),
    b(9, 8, 1, 10, 10, 7, 'metal'),
    b(9, 0, 7, 10, 10, 12, 'metal'),
    // cube ledge and exit platform
    b(5, 0, 0, 9, 4, 8, 'metal', { top: 'floor' }),
    b(-9, 0, -11, -1, 4, -6, 'metal', { top: 'floor' }),
    // cube dispenser tube hanging over the ledge
    b(6.0, 8.2, 2.9, 7.2, 10, 4.1, 'metal', { hidden: true }),
    // exit corridor behind the door, with the elevator shaft at its end
    b(-17, 3, -11, -10, 4, -6, 'floor'),
    ...slab(-17, -10, -11, -6, 7, 8, [[-15.9, -13.3, -9.8, -7.2]], 'metal', { castShadow: false }),
    b(-17, 4, -11, -10, 7, -10, 'metal'),
    b(-17, 4, -7, -10, 7, -6, 'metal'),
    b(-17, 4, -10, -16, 7, -7, 'metal'),
    ...shaft(-15.9, -13.3, -9.8, -7.2, 7, 14),
  ],
  decor(root) {
    lamps(root, [-4.5, 4.5], [-6, 0, 6], 10);
    stripLight(root, -12, 7, -8.5, 3, 'x');
    observationWindow(root, 0, 7.6, 11, Math.PI);
    chamberSign(root, -9, 1.9, 8.6, Math.PI / 2, { number: 1, total: TOTAL, lit: [true, true, true, false, false, false], lines: this.card });
    dispenser(root, 6.6, 3.5, 8.2, 10);
  },
};

// Test Chamber 02
//
// The cube sits at the bottom of a 3 m deep pit with a white floor, out of
// reach: a portal under it drops it through. The button is in a raised alcove
// in the north wall that can't be climbed into; the alcove's ceiling has a
// white patch above the button, so a cube dropped into a floor portal falls
// out of the ceiling onto it. The exit door is in the west wall at floor
// level. The east wall has a high white strip so a player who falls into the
// pit can always portal out.
const chamber02 = {
  number: 2,
  intro: 'Test Chamber 02. What falls into one portal falls out of the other.',
  doorOpen: DOOR_OPEN_LINE,
  card: ['Portals can move what you cannot reach.', 'Momentum carries through.'],
  arrival: { pos: [0, 0, 14.2], yaw: Math.PI },
  exit: { pos: [-14.6, 0, -5], yaw: Math.PI / 2 },
  cube: [5.5, -2.63, 3.5],
  button: [-5.5, 2.2, -14.3],
  door: { x: -10.5, y: 0, z: -5, width: 2, height: 2.6 },
  antline: [[-5.5, 2.25, -13.32], [-5.5, 2.25, -12.06], [-5.5, 0.05, -11.94], [-5.5, 0.05, -5], [-9.94, 0.05, -5]],
  fillLight: [-13.5, 2.4, -5],
  shadow: { x: -3.5, z: 0, half: 18 },
  killY: -25,
  boxes: [
    // floor with the cube pit and a white patch cut out of it
    ...slab(-18, 11, -17, 17, -1, 0, [[4, 7, 2, 5], [-3, 1, -4, 0]], 'metal', { top: 'floor' }),
    b(-3, -1, -4, 1, 0, 0, 'metal', { top: 'whiteFloor' }),
    // the pit: metal walls, white floor
    b(3, -3, 1, 4, -1, 6, 'metal'),
    b(7, -3, 1, 8, -1, 6, 'metal'),
    b(4, -3, 1, 7, -1, 2, 'metal'),
    b(4, -3, 5, 7, -1, 6, 'metal'),
    b(4, -4, 2, 7, -3, 5, 'metal', { top: 'whiteFloor' }),
    // ceilings
    b(-11, 12, -13, 11, 13, 13, 'metal', { castShadow: false }),
    b(-3, 12, 13, 3, 13, 17, 'metal', { castShadow: false }),
    // south wall, with the arrival elevator's alcove
    b(-11, 0, 12, -2, 12, 13, 'metal'),
    b(2, 0, 12, 11, 12, 13, 'metal'),
    b(-3, 0, 13, -2, 12, 17, 'metal'),
    b(2, 0, 13, 3, 12, 17, 'metal'),
    b(-3, 0, 16, 3, 12, 17, 'metal'),
    // north wall, with the opening into the raised button alcove
    b(-11, 0, -13, -8, 12, -12, 'metal'),
    b(-3, 0, -13, 11, 12, -12, 'metal'),
    b(-8, 0, -13, -3, 2.2, -12, 'metal', { top: 'floor' }),
    b(-8, 5.4, -13, -3, 12, -12, 'metal'),
    // button alcove: floor, ceiling with a white patch over the button, walls
    b(-8, 0, -16, -3, 2.2, -13, 'metal', { top: 'floor' }),
    b(-6.8, 5.4, -15.6, -4.2, 6.4, -13, 'white'),
    b(-8, 5.4, -16, -6.8, 6.4, -13, 'metal'),
    b(-4.2, 5.4, -16, -3, 6.4, -13, 'metal'),
    b(-6.8, 5.4, -16, -4.2, 6.4, -15.6, 'metal'),
    b(-9, 0, -17, -8, 12, -13, 'metal'),
    b(-3, 0, -17, -2, 12, -13, 'metal'),
    b(-9, 0, -17, -2, 12, -16, 'metal'),
    // west wall with the exit doorway
    b(-11, 0, -13, -10, 12, -6, 'metal'),
    b(-11, 0, -4, -10, 12, 13, 'metal'),
    b(-11, 2.6, -6, -10, 12, -4, 'metal'),
    // exit corridor and elevator shaft
    b(-17, 0, -7.5, -11, 3, -6.5, 'metal'),
    b(-17, 0, -3.5, -11, 3, -2.5, 'metal'),
    b(-17, 0, -6.5, -16, 3, -3.5, 'metal'),
    ...slab(-17, -11, -7.5, -2.5, 3, 4, [[-15.9, -13.3, -6.3, -3.7]], 'metal', { castShadow: false }),
    ...shaft(-15.9, -13.3, -6.3, -3.7, 3, 10),
    // east wall, white up high
    b(10, 0, -13, 11, 12, -2, 'metal'),
    b(10, 0, 6, 11, 12, 13, 'metal'),
    b(10, 0, -2, 11, 3, 6, 'metal'),
    b(10, 8, -2, 11, 12, 6, 'metal'),
    b(10, 3, -2, 11, 8, 6, 'white'),
    // cube dispenser tube hanging over the pit
    b(4.9, 9, 2.9, 6.1, 12, 4.1, 'metal', { hidden: true }),
  ],
  decor(root) {
    lamps(root, [-5, 5], [-7, 0, 7], 12);
    stripLight(root, -12.2, 3, -5, 1.6, 'x');
    observationWindow(root, -10, 7.5, 3, Math.PI / 2);
    chamberSign(root, 3.6, 1.9, 12, Math.PI, { number: 2, total: TOTAL, lit: [true, true, true, true, false, false], lines: this.card });
    dispenser(root, 5.5, 3.5, 9, 12);
  },
};

// Test Chamber 03
//
// A 6 m wide chasm separates the start side (south) from the goal side
// (north), and the goal side has no white surface that can be seen from the
// start. The way across is a fling: portal up onto the 8 m tower, put one
// portal on the white floor at its foot and the other high on the south wall
// (facing the chasm), and jump. The fall comes out of the wall at about
// 20 m/s and carries across the chasm. The cube starts on the start side and
// has to make the trip too. A white panel on the north face of a pillar on the
// goal side (hidden from the start side) is the way back, and the chasm has a
// white wall at its bottom so a fall into it isn't a dead end.
const chamber03 = {
  number: 3,
  intro: 'Test Chamber 03. A body in motion stays in motion, even through a portal.',
  doorOpen: DOOR_OPEN_LINE,
  card: ['Fall far, fly far.', 'Bring the cube across the gap.'],
  arrival: { pos: [0, 0, 12.6], yaw: Math.PI },
  exit: { pos: [-12.6, 0, -11], yaw: Math.PI / 2 },
  cube: [4.5, 0.37, 6.5],
  button: [3.5, 0, -9],
  door: { x: -8.5, y: 0, z: -11, width: 2, height: 2.6 },
  antline: [[2.52, 0.05, -9], [-6, 0.05, -9], [-6, 0.05, -11], [-7.94, 0.05, -11]],
  fillLight: [-12, 2.4, -11],
  shadow: { x: -3.5, z: -1, half: 17 },
  killY: -25,
  boxes: [
    // floors: start side (with a white patch at the tower's foot), goal side
    // (reaching under the exit corridor), and the bottom of the chasm
    ...slab(-9, 9, 2, 15, -1, 0, [[-4, -1, 5.5, 9.5]], 'metal', { top: 'floor' }),
    b(-4, -1, 5.5, -1, 0, 9.5, 'metal', { top: 'whiteFloor' }),
    b(-16, -1, -17, 9, 0, -4, 'metal', { top: 'floor' }),
    b(-9, -6, -4, 9, -5, 2, 'metal', { top: 'floor' }),
    // chasm walls; the south one has a white panel at the bottom
    b(-9, -5, 2, -2, -1, 3, 'metal'),
    b(-2, -5, 2, 2, -1, 3, 'white'),
    b(2, -5, 2, 9, -1, 3, 'metal'),
    b(-9, -5, -5, 9, -1, -4, 'metal'),
    b(-9, -6, -4, -8, 0, 2, 'metal'),
    b(8, -6, -4, 9, 0, 2, 'metal'),
    // ceiling
    b(-9, 14, -17, 9, 15, 11, 'metal', { castShadow: false }),
    // south wall: white strip high up (the fling exit) above the arrival alcove
    b(-9, 0, 10, -3, 14, 11, 'metal'),
    b(3, 0, 10, 9, 14, 11, 'metal'),
    b(-3, 0, 10, -2, 8, 11, 'metal'),
    b(2, 0, 10, 3, 8, 11, 'metal'),
    b(-2, 7.6, 10, 2, 8, 11, 'metal'),
    b(-3, 8, 10, 3, 12, 11, 'white'),
    b(-3, 12, 10, 3, 14, 11, 'metal'),
    // arrival alcove
    b(-3, 0, 11, -2, 7.6, 15, 'metal'),
    b(2, 0, 11, 3, 7.6, 15, 'metal'),
    b(-3, 0, 14, 3, 7.6, 15, 'metal'),
    b(-3, 7.6, 11, 3, 8.6, 15, 'metal', { castShadow: false }),
    // the tower against the south-west corner, white wall above its top
    b(-8, 0, 5, -4, 8, 10, 'metal', { top: 'floor' }),
    b(-9, 0, 2, -8, 14, 6, 'metal'),
    b(-9, 0, 6, -8, 8, 9.5, 'metal'),
    b(-9, 8, 6, -8, 12.5, 9.5, 'white'),
    b(-9, 12.5, 6, -8, 14, 9.5, 'metal'),
    b(-9, 0, 9.5, -8, 14, 11, 'metal'),
    // east wall: tall white panel on the start side
    b(8, 0, 2, 9, 14, 3, 'metal'),
    b(8, 0, 3, 9, 10, 9, 'white'),
    b(8, 10, 3, 9, 14, 9, 'metal'),
    b(8, 0, 9, 9, 14, 11, 'metal'),
    b(8, 0, -17, 9, 14, -4, 'metal'),
    // goal side: north wall, west wall with the exit doorway
    b(-9, 0, -17, 9, 14, -16, 'metal'),
    b(-9, 0, -17, -8, 14, -12, 'metal'),
    b(-9, 0, -10, -8, 14, -4, 'metal'),
    b(-9, 2.6, -12, -8, 14, -10, 'metal'),
    // walls above the chasm
    b(-9, 0, -4, -8, 14, 2, 'metal'),
    b(8, 0, -4, 9, 14, 2, 'metal'),
    // the way back: a pillar whose north face (hidden from the start side) is white
    b(-1, 0, -12.9, 1, 3.2, -11, 'metal'),
    b(-1, 0, -13, 1, 3.2, -12.9, 'white'),
    // exit corridor and elevator shaft
    b(-16, 0, -13.5, -9, 3, -12.5, 'metal'),
    b(-16, 0, -9.5, -9, 3, -8.5, 'metal'),
    b(-16, 0, -12.5, -15, 3, -9.5, 'metal'),
    ...slab(-16, -9, -13.5, -8.5, 3, 4, [[-13.9, -11.3, -12.3, -9.7]], 'metal', { castShadow: false }),
    ...shaft(-13.9, -11.3, -12.3, -9.7, 3, 10),
    // cube dispenser tube on the start side
    b(3.9, 10, 5.9, 5.1, 14, 7.1, 'metal', { hidden: true }),
  ],
  decor(root) {
    lamps(root, [-4, 4], [-12, -6, 0, 6], 14);
    stripLight(root, -10.6, 3, -11, 1.4, 'x');
    observationWindow(root, 0, 9, -16, 0);
    chamberSign(root, 4.6, 1.9, 10, Math.PI, { number: 3, total: TOTAL, lit: [true, true, true, true, true, false], lines: this.card });
    dispenser(root, 4.5, 6.5, 10, 14);
  },
};

// Walls of a vertical shaft over a hole x0..x1, z0..z1, from y0 up to y1,
// capped at the top.
function shaft(x0, x1, z0, z1, y0, y1) {
  return [
    b(x0 - 1, y0, z0 - 1, x0, y1, z1 + 1, 'metal'),
    b(x1, y0, z0 - 1, x1 + 1, y1, z1 + 1, 'metal'),
    b(x0, y0, z0 - 1, x1, y1, z0, 'metal'),
    b(x0, y0, z1, x1, y1, z1 + 1, 'metal'),
    b(x0 - 1, y1, z0 - 1, x1 + 1, y1 + 1, z1 + 1, 'metal', { castShadow: false }),
  ];
}

export const LEVELS = [chamber01, chamber02, chamber03];
