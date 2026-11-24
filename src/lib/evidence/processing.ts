import { createHash } from "node:crypto";
import sharp from "sharp";
import exifr from "exifr";
import { haversineKm } from "@/lib/correlation/engine";

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 64-bit difference hash (dHash). Robust to re-encoding, resizing and mild
 * compression, which is how forwarded/recycled images usually differ.
 */
export async function perceptualHash(buf: Buffer): Promise<string> {
  const pixels = await sharp(buf, { failOn: "none" })
    .rotate()
    .grayscale()
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  format: string | null;
  hasExif: boolean;
  cameraMake: string | null;
  cameraModel: string | null;
  software: string | null;
  capturedAt: string | null;
  gps: { latitude: number; longitude: number } | null;
}

export async function extractImageMetadata(buf: Buffer): Promise<ImageMetadata> {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  let exif: Record<string, unknown> | undefined;
  try {
    exif = (await exifr.parse(buf, { tiff: true, exif: true, gps: true })) ?? undefined;
  } catch {
    exif = undefined;
  }
  const date = exif?.DateTimeOriginal ?? exif?.CreateDate;
  const lat = typeof exif?.latitude === "number" ? exif.latitude : null;
  const lon = typeof exif?.longitude === "number" ? exif.longitude : null;
  return {
    width: meta.width ?? null,
    height: meta.height ?? null,
    format: meta.format ?? null,
    hasExif: Boolean(exif && Object.keys(exif).length > 0),
    cameraMake: typeof exif?.Make === "string" ? exif.Make : null,
    cameraModel: typeof exif?.Model === "string" ? exif.Model : null,
    software: typeof exif?.Software === "string" ? exif.Software : null,
    capturedAt: date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    gps: lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null,
  };
}

const EDITING_SOFTWARE = /photoshop|gimp|lightroom|snapseed|picsart|canva|facetune|affinity/i;

/**
 * Metadata observations. These are signals for a human reviewer, never proof:
 * messaging apps strip EXIF routinely and metadata can be forged.
 */
export function metadataFlags(
  meta: ImageMetadata,
  report: { occurredAt: Date; latitude: number | null; longitude: number | null },
): { flags: string[]; notes: string[] } {
  const flags: string[] = [];
  const notes: string[] = [];
  if (!meta.hasExif) {
    flags.push("missing_metadata");
    notes.push("No EXIF metadata. Common for images forwarded through messaging apps; not evidence of manipulation.");
  }
  if (meta.capturedAt) {
    const diffH = Math.abs(new Date(meta.capturedAt).getTime() - report.occurredAt.getTime()) / 3_600_000;
    if (diffH > 24) {
      flags.push("capture_time_conflict");
      notes.push(`EXIF capture time differs from the reported incident time by ${diffH.toFixed(0)} hours.`);
    }
  }
  if (meta.gps && report.latitude !== null && report.longitude !== null) {
    const km = haversineKm(meta.gps.latitude, meta.gps.longitude, report.latitude, report.longitude);
    if (km > 25) {
      flags.push("gps_location_conflict");
      notes.push(`EXIF GPS position is ${km.toFixed(0)} km from the reported location.`);
    }
  }
  if (meta.software && EDITING_SOFTWARE.test(meta.software)) {
    flags.push("editing_software_tag");
    notes.push(`EXIF software tag mentions editing software (${meta.software}). Editing is not necessarily deceptive.`);
  }
  return { flags, notes };
}

export function fileKind(mime: string): "image" | "video" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

/** Verify the file's magic bytes match an allowed type (don't trust the browser-supplied MIME). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}
