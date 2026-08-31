# Web-optimized media for README, docs, and deploy references.

| Folder | Size | Role |
|--------|------|------|
| **`Images/`** (this folder, excl. `originals/`) | ~2.5 MB | PNG/JPG/MP4 used by README and docs |
| **`Images/originals/`** | ~456 MB | Full-res backup before optimization — **local only** (gitignored) |

## Formats

- **Demos in README:** animated **GIF** (`Images/*.gif`) — GitHub and Hackster strip `<video>` tags; MP4 lives alongside for local/docs use
- **Demos (local):** MP4 (H.264, 560px wide) in `Images/*.mp4`
- **Screenshots:** PNG/JPG resized to max 1040px wide (`mainUI.png`, `onlinesimulator.png`, …)
- **Logo:** `logostroke.png` at 840px (README); app uses 128px copy in `OnlineSimulator/assets/`

## Restore or re-optimize

From repo root, after `Images/originals/` exists locally:

```bash
cd scripts/optimize-images
npm install
npm run optimize
```

See [`originals/README.md`](originals/README.md) for backup details.
