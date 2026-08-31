/**
 * Non-destructive image optimizer for ARMIC repo assets.
 * Originals must already exist in Images/originals/ (see README there).
 * Overwrites Images/* with optimized versions; converts GIF demos to MP4.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const IMAGES_DIR = path.join(REPO_ROOT, 'Images');
const ORIGINALS_DIR = path.join(IMAGES_DIR, 'originals');

const SCREENSHOT_MAX_WIDTH = 1040;
const GIF_VIDEO_WIDTH = 560;
const LOGO_README_WIDTH = 840;
const LOGO_APP_SIZE = 128;

/** PNG screenshots shown at ~520px in README/docs. */
const PNG_TARGETS = [
  'HW688 & PCA.png',
  'AI Node.png',
  'mainUI.png',
  'Armic_bb.png',
  'applab.png',
  'warmingupagent.png',
  'agentready.png',
  'testmqttUI.png',
  'Arm.png',
  'LogoTxtNB.png',
  'logoNB.png',
  'logoarm.png',
];

const JPG_TARGETS = ['Arduino.jpg', 'logo.jpg'];

const GIF_TARGETS = [
  '1cpose.gif',
  '2trans.gif',
  '3htf.gif',
  '4pivot.gif',
  '5gimme.gif',
  '6orbit.gif',
  '7snake.gif',
  '8cobra.gif',
  '9dumbell.gif',
  '10bicep.gif',
  '11lateral.gif',
  '12elbow.gif',
  '13claw.gif',
  '0.5claude.gif',
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function optimizePng(name) {
  const input = path.join(ORIGINALS_DIR, name);
  const output = path.join(IMAGES_DIR, name);
  const before = await fileSize(input);

  await sharp(input)
    .resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(output);

  const after = await fileSize(output);
  console.log(`PNG  ${name}: ${mb(before)} -> ${kb(after)}`);
}

async function optimizeJpg(name) {
  const input = path.join(ORIGINALS_DIR, name);
  const output = path.join(IMAGES_DIR, name);
  const before = await fileSize(input);

  await sharp(input)
    .resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(output);

  const after = await fileSize(output);
  console.log(`JPG  ${name}: ${mb(before)} -> ${kb(after)}`);
}

async function optimizeLogoReadme() {
  const input = path.join(ORIGINALS_DIR, 'logostroke.png');
  const output = path.join(IMAGES_DIR, 'logostroke.png');
  const before = await fileSize(input);

  await sharp(input)
    .resize({ width: LOGO_README_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10, palette: true })
    .toFile(output);

  const after = await fileSize(output);
  console.log(`LOGO readme logostroke.png: ${kb(before)} -> ${kb(after)}`);
}

async function optimizeLogoApp() {
  const input = path.join(ORIGINALS_DIR, 'logostroke.png');
  const appDir = path.join(REPO_ROOT, 'OnlineSimulator', 'assets');
  const backupDir = path.join(appDir, 'originals');
  const appLogo = path.join(appDir, 'logostroke.png');

  await fs.mkdir(backupDir, { recursive: true });
  try {
    await fs.access(appLogo);
    await fs.copyFile(appLogo, path.join(backupDir, 'logostroke.png'));
  } catch {
    /* first run */
  }

  const before = await fileSize(input);
  await sharp(input)
    .resize(LOGO_APP_SIZE, LOGO_APP_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, effort: 10, palette: true })
    .toFile(appLogo);

  const after = await fileSize(appLogo);
  console.log(`LOGO app   logostroke.png: ${kb(before)} -> ${kb(after)}`);
}

async function gifToMp4(name) {
  const input = path.join(ORIGINALS_DIR, name);
  const base = name.replace(/\.gif$/i, '');
  const output = path.join(IMAGES_DIR, `${base}.mp4`);
  const before = await fileSize(input);

  // Scale to demo width, H.264 for GitHub README <video> tags.
  const vf = `scale=${GIF_VIDEO_WIDTH}:-2:flags=lanczos,fps=12`;
  await execFileAsync(ffmpegPath, [
    '-y',
    '-i',
    input,
    '-an',
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-crf',
    '28',
    output,
  ]);

  const after = await fileSize(output);
  console.log(`MP4  ${base}.mp4: ${mb(before)} -> ${kb(after)}`);
  return `${base}.mp4`;
}

async function removeWorkingGifs() {
  for (const name of GIF_TARGETS) {
    const gifPath = path.join(IMAGES_DIR, name);
    try {
      await fs.unlink(gifPath);
      console.log(`DEL  removed working copy ${name} (original in originals/)`);
    } catch {
      /* already removed */
    }
  }
}

async function summarize() {
  const files = await fs.readdir(IMAGES_DIR);
  let total = 0;
  for (const f of files) {
    if (f === 'originals') continue;
    const stat = await fs.stat(path.join(IMAGES_DIR, f));
    if (stat.isFile()) total += stat.size;
  }
  console.log(`\nImages/ working set (excl. originals/): ${mb(total)}`);
}

async function main() {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found');

  await fs.access(ORIGINALS_DIR);
  console.log(`Using originals: ${ORIGINALS_DIR}\n`);

  for (const name of PNG_TARGETS) {
    await optimizePng(name);
  }
  for (const name of JPG_TARGETS) {
    await optimizeJpg(name);
  }
  await optimizeLogoReadme();
  await optimizeLogoApp();

  console.log('\n--- GIF -> MP4 ---');
  for (const name of GIF_TARGETS) {
    await gifToMp4(name);
  }
  await removeWorkingGifs();
  await summarize();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
