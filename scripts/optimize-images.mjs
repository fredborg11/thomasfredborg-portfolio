import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const inputRoot = path.resolve("public/media");
const outputRoot = path.resolve("public/media-optimized");
const rasterExtensions = new Set([".png", ".jpg", ".jpeg"]);
const maxWidth = 2000;
const quality = 82;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });

  const files = await walk(inputRoot);
  const rasters = files.filter((file) => rasterExtensions.has(path.extname(file).toLowerCase()));

  for (const file of rasters) {
    const relative = path.relative(inputRoot, file);
    const output = path.join(outputRoot, relative.replace(/\.(png|jpe?g)$/i, ".webp"));

    await fs.mkdir(path.dirname(output), { recursive: true });

    await sharp(file)
      .rotate()
      .resize({
        width: maxWidth,
        height: maxWidth,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality,
        effort: 4,
      })
      .toFile(output);
  }

  console.log(`Optimized ${rasters.length} portfolio images to WebP.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
