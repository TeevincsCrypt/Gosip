import sharp from "sharp";

/** Deterministic synthetic test images (gradients/shapes) — no real photos. */
export async function testImage(seed: number, size = 256): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="${seed % 2}" y2="1">
      <stop offset="0" stop-color="hsl(${(seed * 47) % 360},60%,40%)"/>
      <stop offset="1" stop-color="hsl(${(seed * 91) % 360},60%,70%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${(seed * 37) % size}" cy="${(seed * 53) % size}" r="${40 + (seed % 30)}" fill="#fff" opacity="0.8"/>
    <rect x="${(seed * 19) % 150}" y="${(seed * 29) % 150}" width="80" height="40" fill="#000" opacity="0.6"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
