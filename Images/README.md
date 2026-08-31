# Web-optimized media for README, docs, and deploy references.

| Folder | Size | Role |
|--------|------|------|
| **`Images/`** (this folder, excl. `originals/`) | ~2.5 MB | PNG/JPG/MP4 used by README and docs |
| **`Images/originals/`** | ~456 MB | Full-res backup before optimization — **local only** (gitignored) |

## Formats

- **Demos:** MP4 (H.264, 560px wide) — replaces former multi‑MB GIFs
- **Screenshots:** PNG/JPG resized to max 1040px wide
- **Logo:** `logostroke.png` at 840px (README); app uses 128px copy in `OnlineSimulator/assets/`

## Restore or re-optimize

From repo root, after `Images/originals/` exists locally:

```bash
cd scripts/optimize-images
npm install
npm run optimize
```

See [`originals/README.md`](originals/README.md) for backup details.
