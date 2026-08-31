# Armic Online Simulator

Pure Expo managed React Native / Web app running the **full ARMIC 4-DOF arm
simulator logic in JavaScript/TypeScript**, with a three.js digital twin
rendered via `expo-gl` + `expo-three`. No Arduino / board connection required —
everything (IK, FK, HTL lift protocol, S-curve motion, 5-layer safety, 50 Hz
tick loop, rep telemetry, presets) runs locally. Optional deploy to EAS Hosting
for a public URL with Agent API routes — no store credentials, no native builds.

## 1. Install + run

```bash
npm install
```

> **Note:** `.npmrc` sets `legacy-peer-deps=true` to resolve the `expo-three` /
> `three@0.160` peer dependency conflict. No extra flags needed.

Dev preview (browser, recommended first run):

```bash
npm run web
```

Dev preview (Expo Go on phone, scan the QR):

```bash
npm start
```

## 2. Web build + serve locally

Export the web bundle (Metro writes to `dist/`; includes API routes in server mode):

```bash
npm run webbuild
```

Build + preview the export with the built-in Expo web server:

```bash
npm run webserve
```

## 3. Deploy to Expo (EAS Hosting)

This project is configured for **EAS Hosting** with `web.output: "server"` so the
Agent tab and `/api/agent/*` routes work in production. You need a free
[Expo account](https://expo.dev/signup) and the EAS CLI.

Log in once:

```bash
npx eas-cli login
```

Export + deploy (preview URL):

```bash
npm run deploy
```

Or step by step:

```bash
npx expo export --platform web
npx eas-cli deploy
```

**Production URL:** [https://onlinesimulator.expo.app](https://onlinesimulator.expo.app)

```bash
npm run deploy:prod
```

On first deploy, EAS prompts for a preview subdomain. The project is linked via
`app.json` → `extra.eas.projectId` (slug: `onlinesimulator`).

### What works on EAS

| Feature | Live on EAS? |
|---|---|
| 3D arm simulator + presets | Yes |
| Agent chat (`/api/agent/chat`) | Yes |
| Rehab routes / run-protocol API | Yes |
| Real UNO Q hardware | No (simulator only) |

### Simulator-only deploy (no Agent API)

If you only need the 3D twin and **not** the Agent tab, set
`web.output` to `"static"` in `app.json`, re-export, and deploy. The Agent tab
will 404 on `/api/agent/chat`.

### Other static hosts

You can also drop `dist/` on Netlify, Vercel, Cloudflare Pages, S3, or GitHub
Pages. For static hosts, use `web.output: "static"` — API routes are not
included.

## 4. Quality checks

```bash
npm run lint    # Expo lint rules
npm run tsc     # Strict TypeScript, 0 errors expected
```

## 5. What's inside the simulator logic?

All in `src/sim/*.ts`, no native code, no external services:

| File | What it does |
|---|---|
| `safety.ts` | 5-layer safety gate (E-stop → watchdog 1500 ms → soft joint bands → max delta 30°/tick → 15 mm floor guard) |
| `kinematics.ts` | Analytical FK + Law-of-Cosines β IK, dual-branch + manipulability pick, 0.5 mm FK self-verify, Yoshikawa derate |
| `s_curve.ts` | Cubic easing + 7-segment jerk-limited quintic S-curve profile + duration est |
| `htl.ts` | Heavy-Tucked-Lift 4-phase FSM (REACH → FOLD → CARRY → HOME 95 → RELEASE) with tucked torque save |
| `simulator.ts` | 6-stage Cartesian pipeline, 50 Hz tick, 9 route presets, MPU watchdog, rep quality buffer |

Server agent backend runs on expo-router functions under
`app/api/agent/*` (chat stream, run-protocol, routes catalog, rehab intent
matching) — pure deterministic 4-tool orchestrator, no LLM API keys, no
hardware tunnel.

UI is `App.tsx` (GLView Three.js 5-link twin + joint sliders + 9 preset
buttons + telemetry HUD + Agent chat tab) and `src/scene/armScene.ts`
(Three.js r160 scene, PBR mats, shadow map, grid floor, puck).
