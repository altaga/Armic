#!/usr/bin/env bash
# Local equivalent of .github/workflows/mermaid-to-png.yml
# Requires Docker. Renders every ```mermaid block in *.md → Docs/refs/generated/*.png

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/Docs/refs/generated"
PNG_SCALE="${PNG_SCALE:-2}"
IMAGE="${MERMAID_CLI_IMAGE:-minlag/mermaid-cli:10.9.1}"

mkdir -p "$OUT_DIR"

docker run --rm \
  -v "${REPO_ROOT}:/work" \
  -w /work \
  -e OUT_DIR="Docs/refs/generated" \
  -e PNG_SCALE="${PNG_SCALE}" \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail
    python3 - "$OUT_DIR" "$PNG_SCALE" <<'"'"'PY'"'"'
import hashlib, pathlib, re, subprocess, sys

out_dir = pathlib.Path(sys.argv[1])
scale = int(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)

md_files = sorted(p for p in pathlib.Path(".").rglob("*.md")
                  if not any(part.startswith(".") for part in p.parts)
                  and not str(p).startswith("Side/"))

fence_re = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)
index_rows = []
total_rendered = 0

for md in md_files:
    text = md.read_text(encoding="utf-8")
    for idx, m in enumerate(fence_re.finditer(text), start=1):
        body = m.group(1).strip()
        if not body:
            continue
        slug = md.stem + "-mermaid-" + str(idx)
        safe_slug = re.sub(r"[^A-Za-z0-9._-]", "-", slug)
        mmd_path = out_dir / (safe_slug + ".mmd")
        png_path = out_dir / (safe_slug + ".png")
        mmd_path.write_text(body, encoding="utf-8")
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:10]
        hash_path = out_dir / (safe_slug + ".sha256")
        if hash_path.exists() and png_path.exists() and hash_path.read_text().strip() == digest:
            index_rows.append((str(md), idx, str(png_path), "CACHED"))
            continue
        cmd = ["mmdc", "-p", "/puppeteer-config.json", "-i", str(mmd_path),
               "-o", str(png_path), "-b", "white", "-s", str(scale), "-t", "default"]
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=180)
        hash_path.write_text(digest + "\n", encoding="utf-8")
        index_rows.append((str(md), idx, str(png_path), "RENDERED"))
        total_rendered += 1

index_path = out_dir / "INDEX.md"
lines = ["# Mermaid PNG render index (local script)", "",
         "| Source Markdown | Block # | Output PNG | Status |", "|---|---|---|---|"]
for row in sorted(index_rows):
    src, blk, png, st = row
    lines.append(f"| `{src}` | {blk} | [`{png}`]({png}) | {st} |")
lines += ["", f"Total fresh renders: **{total_rendered}**.", ""]
index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("DONE. Rendered:", total_rendered)
PY
  '

echo "Output: ${OUT_DIR}/INDEX.md"
