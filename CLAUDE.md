# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A real-time three-body gravitational simulation rendered on HTML5 Canvas. Built with React 19 + TypeScript + Vite 8. The simulation models 3 suns and 1 planet using a Yoshida 4th-order symplectic integrator with Aarseth-style gravitational softening. Users can drag to rotate the 3D view. The UI is bilingual (Chinese/English).

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — TypeScript check + Vite production build (`tsc -b && vite build`)
- `npm run lint` — ESLint across all `.ts`/`.tsx` files
- `npm run preview` — Preview production build locally

No test framework is configured.

## Architecture

### Simulation Core (`src/simulation/`)

**`physics.ts`** — Pure computational module, no DOM dependencies:
- `Body` interface: position (x,y,z), velocity (vx,vy,vz), mass, color, trail history
- `SimConfig` interface: all tunable parameters (masses, softening, constraints, trail settings, time scale)
- `stepYoshida()` — Main integration step. Uses 4 drift-kick stages with Yoshida 1990 coefficients (W0, W1). Called 8 substeps per frame from the animation loop.
- `computeAcceleration()` — Pairwise gravity with 3-zone softening: linear inside `ras`, blended in `ras..k*ras`, pure inverse-square beyond.
- `computeConstraintForce()` — Only applies to body index 3 (the planet), pulls it back toward center of mass when it exceeds distance threshold `bz`.
- `createSystem()` — Initializes 3 suns in equilateral triangle + 1 planet near origin, all with random velocities.
- `checkDivergence()` — Auto-resets if any body exceeds distance `DD` from center of mass.

**`renderer.ts`** — Canvas 2D rendering with pseudo-3D:
- Module-level camera state (`camX`, `camY`, `camScale`) with smooth interpolation toward center of mass.
- `applyRotation()` — Converts 3D positions to 2D via rotation matrices driven by mouse/touch drag angles.
- `render()` — Full frame: radial gradient background, 600 twinkling stars, trails (tapered with age-based alpha), gravity connection lines between suns, z-sorted body rendering with glow/corona effects.
- Adaptive zoom: `camScale` automatically adjusts based on maximum body distance from center of mass.

### App Layer (`src/`)

**`App.tsx`** — Single component, all state in refs (not React state) for performance:
- `bodiesRef` / `configRef` — Mutable simulation state outside React's render cycle.
- `requestAnimationFrame` loop: 8 physics substeps per frame, divergence check, canvas render, clock overlay.
- Mouse/touch handlers update rotation angles passed to renderer via `setRotation()`.
- UI controls mutate `configRef.current` directly (trail toggle, speed cycling).

**`App.css`** — Full-viewport dark theme with glassmorphism controls (`backdrop-filter: blur`).

### Key Design Decisions

- **Refs over state**: Physics bodies and config use `useRef` to avoid React re-renders on every frame. Only `diverged` and `showUI` use `useState`.
- **No component extraction**: The `src/components/` directory is empty. Everything lives in `App.tsx`.
- **Trails stored per-body**: Each `Body.trail` is a `Vec3[]` stored relative to center of mass, capped at `trailLength`.
- **Softening is critical**: The 3-zone softening in `computeAcceleration()` prevents numerical blow-up at close approaches. Changing `ras` or `kSoft` without care will cause divergence.
