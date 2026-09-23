/**
 * optimize-images.cjs — generează variante WebP pentru imaginile site-ului.
 * Rulează automat prin .github/workflows/optimize-images.yml la push pe imagini JPG.
 * Local (opțional): npm install sharp --no-save && node optimize-images.cjs
 *
 * Reguli (JPG-urile originale NU se modifică):
 *   hero-apartament.jpg      -> hero-apartament-828.webp, hero-apartament.webp
 *   images/zona/X.jpg        -> images/zona/X-800.webp
 *   images/<categorie>/N.jpg -> images/<categorie>/N-600.webp, images/<categorie>/N.webp
 *   + images/gallery.json (lista pozelor pe categorii; galeria nu mai „ghicește” fișierele -> fără 404)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = __dirname;
const MAX_FULL = 1600; // latura maximă pentru varianta „full”

async function toWebp(src, dest, width, quality) {
  let img = sharp(src).rotate();
  const meta = await img.metadata();
  const w = width ? Math.min(width, meta.width) : Math.min(MAX_FULL, meta.width);
  img = img.resize({ width: w, withoutEnlargement: true });
  await img.webp({ quality, effort: 6 }).toFile(dest);
  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log("  " + path.relative(ROOT, dest) + " (" + w + "px, " + kb + " KB)");
}

function jpgsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return /\.jpe?g$/i.test(f); })
    .map(function (f) { return path.join(dir, f); });
}

(async function main() {
  try {
    const hero = path.join(ROOT, "hero-apartament.jpg");
    if (fs.existsSync(hero)) {
      await toWebp(hero, path.join(ROOT, "hero-apartament-828.webp"), 828, 75);
      await toWebp(hero, path.join(ROOT, "hero-apartament.webp"), null, 78);
    }

    const imagesDir = path.join(ROOT, "images");
    const dirs = fs.existsSync(imagesDir)
      ? fs.readdirSync(imagesDir, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); })
      : [];

    const manifest = {};
    for (const d of dirs) {
      const dir = path.join(imagesDir, d.name);
      if (d.name !== "zona") {
        manifest[d.name] = jpgsIn(dir)
          .map(function (f) { return path.basename(f); })
          .filter(function (b) { return /^\d+\.jpe?g$/i.test(b); })
          .map(function (b) { return parseInt(b, 10); })
          .filter(function (n) { return n > 0; })
          .sort(function (a, b) { return a - b; });
      }
      for (const file of jpgsIn(dir)) {
        const base = file.replace(/\.jpe?g$/i, "");
        if (d.name === "zona") {
          await toWebp(file, base + "-800.webp", 800, 72);
        } else {
          await toWebp(file, base + "-600.webp", 600, 75);
          await toWebp(file, base + ".webp", null, 80);
        }
      }
    }
    fs.writeFileSync(path.join(imagesDir, "gallery.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log("  images/gallery.json: " + JSON.stringify(manifest));
    console.log("Gata.");
  } catch (err) {
    console.error("Eroare la optimizarea imaginilor:", err);
    process.exit(1);
  }
})();
