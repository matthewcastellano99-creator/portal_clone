// Global tuning values. Units are metres, seconds and radians.

export const PLAYER = {
  half: [0.3, 0.9, 0.3], // collision box half extents (1.8 m tall)
  eyeOffset: 0.72, // eye height above the body centre (1.62 m above the feet)
  walkSpeed: 5.2,
  groundAccel: 11,
  airAccel: 2.2,
  friction: 7,
  stopSpeed: 1.6,
  jumpSpeed: 6.4,
  reach: 2.4, // how far away the cube can be grabbed from
  lookSensitivity: 0.0022,
};

export const PHYSICS = {
  gravity: 20,
  maxFallSpeed: 40,
  fixedStep: 1 / 120,
  maxSubstepDistance: 0.12,
};

export const PORTAL = {
  width: 1.3,
  height: 2.2,
  maxRecursion: 4,
  tunnelDepth: 3, // how far behind a portal's surface a body may travel before it must have teleported
  searchRadius: 1.3, // how far a portal may be nudged to fit on a surface
  colors: [0x2a8cff, 0xff8a1c], // blue, orange
};

export const CUBE = {
  size: 0.72,
  holdDistance: 1.75,
  dropDistance: 2.6,
};

export const RENDER = {
  fov: 72,
  near: 0.03,
  far: 300,
  maxPixelRatio: 1.5,
  bloom: { strength: 0.4, radius: 0.25, threshold: 0.95 },
};
