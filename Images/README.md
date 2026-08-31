# Web-optimized media for README, docs, and deploy references.

| Folder | Role |
|--------|------|
| **`Images/`** (excl. `originals/`) | PNG/JPG for README · MP4 for local/demo reel |
| **`Images/originals/`** | Full-res backup — **local only** (gitignored) |

## README policy (GitHub / Hackster)

- **Use PNG/JPG only** in markdown — `<img>` or `![alt](path)`.
- **Do not embed `<video>` or `.gif`** in README — GitHub strips video tags; GIFs are not committed to keep repo size down.
- **MP4 clips** (`Images/*.mp4`) are tracked for local viewing and contest reels — link by filename in [docs/demos-and-exercises.md](../docs/demos-and-exercises.md).

## Tracked screenshots (each used once in README)

| File | Section |
|------|---------|
| `logostroke.png` | Header |
| `Armic_bb.png` | BOM wiring |
| `Arduino.jpg` · `Arm.png` | Hardware hero |
| `mainUI.png` · `testmqttUI.png` · `applab.png` · `AI Node.png` | Web UI |
| `HW688 & PCA.png` | Power chain |
| `onlinesimulator.png` | Online Simulator |
| `warmingupagent.png` · `agentready.png` | Edge agent |

## Re-optimize

From repo root, after `Images/originals/` exists locally:

```bash
cd scripts/optimize-images
npm install
npm run optimize
```

See [`originals/README.md`](originals/README.md).
