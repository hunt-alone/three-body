/**
 * Three-Body Problem Simulation
 * Based on Yoshida 4th-order symplectic integrator (1990)
 * With Aarseth-style gravitational softening
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mass: number;
  color: Vec3;       // RGB 0-1
  trail: Vec3[];
}

// Use scaled G for visible real-time motion
const G = 1.0;
const DT = 0.004;

// Yoshida 1990 coefficients
const W1 = 1.35120719196;
const W0 = -1.70241438392;
const C1 = W1 / 2;
const C2 = (W0 + W1) / 2;
const C3 = (W0 + W1) / 2;
const C4 = W1 / 2;
const D1 = W1;
const D2 = W0;
const D3 = W1;

// Configurable parameters
export interface SimConfig {
  mass1: number;
  mass2: number;
  mass3: number;
  fourthMass: number;
  color1: Vec3;
  color2: Vec3;
  color3: Vec3;
  color4: Vec3;
  ras: number;        // softening distance
  kSoft: number;      // softening multiplier
  ky: number;          // constraint force coefficient
  bz: number;          // constraint distance threshold
  exy: number;         // constraint force exponent
  trailEnabled: boolean;
  trailLength: number;
  DD: number;          // center-of-mass distance threshold
  timeScale: number;   // simulation speed multiplier
}

export const DEFAULT_CONFIG: SimConfig = {
  mass1: 10,
  mass2: 10,
  mass3: 7,
  fourthMass: 0.01,
  color1: { x: 0.9, y: 0.5, z: 0.3 },   // warm orange
  color2: { x: 0.8, y: 0.6, z: 0.35 },  // golden
  color3: { x: 0.85, y: 0.4, z: 0.35 }, // reddish
  color4: { x: 0.25, y: 0.55, z: 0.75 }, // muted teal-blue planet
  ras: 0.15,
  kSoft: 2.8,
  ky: 0.5,
  bz: 2.0,
  exy: 1.0,
  trailEnabled: true,
  trailLength: 400,
  DD: 8.0,
  timeScale: 3.0,
};

function vecLength(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function vecNormalize(x: number, y: number, z: number): Vec3 {
  const len = vecLength(x, y, z);
  return len > 0 ? { x: x / len, y: y / len, z: z / len } : { x: 0, y: 0, z: 0 };
}

// Aarseth-style gravitational softening
function computeAcceleration(b1: Body, b2: Body, config: SimConfig): Vec3 {
  const dx = b2.x - b1.x;
  const dy = b2.y - b1.y;
  const dz = b2.z - b1.z;

  const distance = Math.max(vecLength(dx, dy, dz), 1e-5);
  const dir = vecNormalize(dx, dy, dz);

  const ras = config.ras;
  const k = config.kSoft;
  const k_ras = k * ras;

  const beta = 3 / (k - 1);
  const alpha = 1 - beta;

  let accelMagnitude: number;

  if (distance <= ras) {
    accelMagnitude = G * b2.mass * distance / Math.pow(ras, 3);
  } else if (distance < k_ras) {
    const factor = alpha + beta * (distance / ras);
    accelMagnitude = factor * G * b2.mass / (distance * distance);
  } else {
    accelMagnitude = G * b2.mass / (distance * distance);
  }

  return {
    x: accelMagnitude * dir.x,
    y: accelMagnitude * dir.y,
    z: accelMagnitude * dir.z,
  };
}

// Constraint force on planet (4th body) to keep it bound
function computeConstraintForce(
  body: Body,
  bodyIndex: number,
  bodies: Body[],
  com: Vec3,
  config: SimConfig
): Vec3 {
  if (bodyIndex !== 3) return { x: 0, y: 0, z: 0 };

  const dx = com.x - body.x;
  const dy = com.y - body.y;
  const dz = com.z - body.z;
  const distance = Math.max(vecLength(dx, dy, dz), 1e-5);

  if (distance <= config.bz) return { x: 0, y: 0, z: 0 };

  const mainMass = bodies[0].mass + bodies[1].mass + bodies[2].mass;
  const forceMagnitude =
    config.ky * G * body.mass * mainMass * Math.pow(distance - config.bz, config.exy);
  const dir = vecNormalize(dx, dy, dz);

  return {
    x: forceMagnitude * dir.x,
    y: forceMagnitude * dir.y,
    z: forceMagnitude * dir.z,
  };
}

function computeAllAccelerations(bodies: Body[], com: Vec3, config: SimConfig): Vec3[] {
  const accels: Vec3[] = bodies.map(() => ({ x: 0, y: 0, z: 0 }));

  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const a = computeAcceleration(bodies[i], bodies[j], config);
      accels[i].x += a.x;
      accels[i].y += a.y;
      accels[i].z += a.z;
    }
    const cf = computeConstraintForce(bodies[i], i, bodies, com, config);
    accels[i].x += cf.x / bodies[i].mass;
    accels[i].y += cf.y / bodies[i].mass;
    accels[i].z += cf.z / bodies[i].mass;
  }

  return accels;
}

export function computeCenterOfMass(bodies: Body[]): Vec3 {
  let totalMass = 0, cx = 0, cy = 0, cz = 0;
  for (const b of bodies) {
    totalMass += b.mass;
    cx += b.mass * b.x;
    cy += b.mass * b.y;
    cz += b.mass * b.z;
  }
  return totalMass > 0
    ? { x: cx / totalMass, y: cy / totalMass, z: cz / totalMass }
    : { x: 0, y: 0, z: 0 };
}

/**
 * Yoshida 4th-order symplectic step (physics only, no trail recording)
 */
export function stepYoshida(bodies: Body[], config: SimConfig, frametime: number): void {
  const k = config.timeScale * 1000 * frametime / 30;
  const timeStep = DT * k;
  const com = computeCenterOfMass(bodies);

  // Stage 1: drift
  for (const b of bodies) {
    b.x += C1 * timeStep * b.vx;
    b.y += C1 * timeStep * b.vy;
    b.z += C1 * timeStep * b.vz;
  }
  // Stage 2: kick
  const a1 = computeAllAccelerations(bodies, com, config);
  for (let i = 0; i < bodies.length; i++) {
    bodies[i].vx += D1 * timeStep * a1[i].x;
    bodies[i].vy += D1 * timeStep * a1[i].y;
    bodies[i].vz += D1 * timeStep * a1[i].z;
  }
  // Stage 3: drift
  for (const b of bodies) {
    b.x += C2 * timeStep * b.vx;
    b.y += C2 * timeStep * b.vy;
    b.z += C2 * timeStep * b.vz;
  }
  // Stage 4: kick
  const a2 = computeAllAccelerations(bodies, com, config);
  for (let i = 0; i < bodies.length; i++) {
    bodies[i].vx += D2 * timeStep * a2[i].x;
    bodies[i].vy += D2 * timeStep * a2[i].y;
    bodies[i].vz += D2 * timeStep * a2[i].z;
  }
  // Stage 5: drift
  for (const b of bodies) {
    b.x += C3 * timeStep * b.vx;
    b.y += C3 * timeStep * b.vy;
    b.z += C3 * timeStep * b.vz;
  }
  // Stage 6: kick
  const a3 = computeAllAccelerations(bodies, com, config);
  for (let i = 0; i < bodies.length; i++) {
    bodies[i].vx += D3 * timeStep * a3[i].x;
    bodies[i].vy += D3 * timeStep * a3[i].y;
    bodies[i].vz += D3 * timeStep * a3[i].z;
  }
  // Stage 7: drift
  for (const b of bodies) {
    b.x += C4 * timeStep * b.vx;
    b.y += C4 * timeStep * b.vy;
    b.z += C4 * timeStep * b.vz;
  }
}

/**
 * Record trail positions (call once per frame, not per substep)
 */
export function recordTrails(bodies: Body[], config: SimConfig): void {
  if (!config.trailEnabled) return;
  const com = computeCenterOfMass(bodies);
  for (const b of bodies) {
    b.trail.push({
      x: b.x - com.x,
      y: b.y - com.y,
      z: b.z - com.z,
    });
    if (b.trail.length > config.trailLength) {
      b.trail.shift();
    }
  }
}

/**
 * Initialize the 4-body system: 3 suns in equilateral triangle + 1 planet
 */
export function createSystem(config: SimConfig): Body[] {
  const bodies: Body[] = [
    {
      x: 0, y: 1, z: 0,
      vx: (Math.random() - 0.5) * 1,
      vy: (Math.random() - 0.5) * 1,
      vz: (Math.random() - 0.5) * 1,
      mass: config.mass1,
      color: config.color1,
      trail: [],
    },
    {
      x: -0.866, y: -0.5, z: 0,
      vx: (Math.random() - 0.5) * 1,
      vy: (Math.random() - 0.5) * 1,
      vz: (Math.random() - 0.5) * 1,
      mass: config.mass2,
      color: config.color2,
      trail: [],
    },
    {
      x: 0.866, y: -0.5, z: 0,
      vx: (Math.random() - 0.5) * 1,
      vy: (Math.random() - 0.5) * 1,
      vz: (Math.random() - 0.5) * 1,
      mass: config.mass3,
      color: config.color3,
      trail: [],
    },
    {
      x: 0, y: -0.2, z: 0.15,
      vx: 0,
      vy: 0,
      vz: 0,
      mass: config.fourthMass,
      color: config.color4,
      trail: [],
    },
  ];
  return bodies;
}

/**
 * Check if any body has drifted too far from center of mass
 */
export function checkDivergence(bodies: Body[], config: SimConfig): boolean {
  const com = computeCenterOfMass(bodies);
  return bodies.some((b) => {
    const dx = b.x - com.x;
    const dy = b.y - com.y;
    const dz = b.z - com.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > config.DD;
  });
}
