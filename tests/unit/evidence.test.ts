import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hammingHex } from "@/lib/correlation/engine";
import { metadataFlags, perceptualHash, sha256Hex, sniffMime } from "@/lib/evidence/processing";
import { testImage } from "../support/fixtures";

describe("evidence hashing", () => {
  it("produces stable 64-bit perceptual hashes", async () => {
    const img = await testImage(3);
    const h = await perceptualHash(img);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await perceptualHash(img)).toBe(h);
  });

  it("detects near-duplicates after resize/re-encode", async () => {
    const img = await testImage(5);
    const resized = await sharp(img).resize(128).jpeg({ quality: 50 }).toBuffer();
    expect(sha256Hex(img)).not.toBe(sha256Hex(resized));
    const d = hammingHex(await perceptualHash(img), await perceptualHash(resized));
    expect(d).toBeLessThanOrEqual(10);
  });

  it("separates different images", async () => {
    const d = hammingHex(await perceptualHash(await testImage(1)), await perceptualHash(await testImage(8)));
    expect(d).toBeGreaterThan(10);
  });

  it("sniffs real file types from magic bytes", async () => {
    expect(sniffMime(await testImage(1))).toBe("image/jpeg");
    expect(sniffMime(await sharp(await testImage(1)).png().toBuffer())).toBe("image/png");
    expect(sniffMime(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });

  it("flags missing and conflicting metadata without asserting manipulation", () => {
    const { flags, notes } = metadataFlags(
      { width: 1, height: 1, format: "jpeg", hasExif: true, cameraMake: null, cameraModel: null, software: "Adobe Photoshop", capturedAt: "2020-01-01T00:00:00Z", gps: { latitude: 51.5, longitude: -0.12 } },
      { occurredAt: new Date("2026-11-20T00:00:00Z"), latitude: 7.43, longitude: 3.91 },
    );
    expect(flags).toEqual(expect.arrayContaining(["capture_time_conflict", "gps_location_conflict", "editing_software_tag"]));
    expect(notes.join(" ")).toMatch(/not necessarily deceptive/);
    const none = metadataFlags(
      { width: 1, height: 1, format: "jpeg", hasExif: false, cameraMake: null, cameraModel: null, software: null, capturedAt: null, gps: null },
      { occurredAt: new Date(), latitude: null, longitude: null },
    );
    expect(none.flags).toEqual(["missing_metadata"]);
  });
});
