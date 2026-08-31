# Web-optimized media for README, docs, and deploy references.

| Folder | Role |
|--------|------|
| **`Images/`** | PNG/JPG screenshots + palette-optimized GIF demos |
| **`Images/originals/`** | Full-res backup — **local only** (gitignored) |
| **`Docs/refs/generated/`** | Mermaid → PNG for Hackster / offline README |

## README motion (GIF)

Regenerate from MP4 (palette, 400px, 8 fps):

```bash
cd scripts/optimize-images
npm install
npm run gifs
```

Targets: `10bicep`, `11lateral`, `12elbow`, `3htf`, `6orbit`, `8cobra`, `2trans`, `9dumbell`, `0.5claude`.

## Story illustrations (PNG)

README narrative assets — **illustrations only**, not clinical photos:

- `problem-home-pt-gap.png` — Problem vignette (Maria: older woman, isolation, uncertain home PT)

Story Introduction uses **real bench photos** (`Arduino.jpg`, `Arm.png`) — not generated hardware renders.

## README diagrams (PNG)

Hackster does not render Mermaid — README embeds **`Docs/refs/generated/README-mermaid-N.png`** above each block.

```bash
cd scripts/optimize-images
npm run render-readme
```

CI also renders on push via [`.github/workflows/mermaid-to-png.yml`](../.github/workflows/mermaid-to-png.yml).

## Screenshots (PNG/JPG)

Run full optimize (needs `Images/originals/`):

```bash
npm run optimize
```
