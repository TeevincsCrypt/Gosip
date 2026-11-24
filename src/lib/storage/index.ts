import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

/**
 * Evidence storage. Uses a PRIVATE Supabase Storage bucket when configured;
 * otherwise a local directory for development. Files are never served
 * directly — the /api/evidence/[id]/file route authorises every read.
 */
export interface EvidenceStorage {
  backend: "supabase" | "local";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

let supabase: SupabaseClient | null = null;

function supabaseStorage(): EvidenceStorage {
  supabase ??= createClient(config.storage.supabaseUrl!, config.storage.serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = config.storage.bucket;
  return {
    backend: "supabase",
    async put(key, data, contentType) {
      const { error } = await supabase!.storage.from(bucket).upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`Evidence upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await supabase!.storage.from(bucket).download(key);
      if (error || !data) throw new Error(`Evidence download failed: ${error?.message ?? "not found"}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

function localStorage(): EvidenceStorage {
  const root = path.resolve(config.storage.localDir);
  const safe = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    backend: "local",
    async put(key, data) {
      const full = safe(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data, { flag: "wx" });
    },
    async get(key) {
      return readFile(safe(key));
    },
  };
}

export function getStorage(): EvidenceStorage {
  if (config.storage.supabaseUrl && config.storage.serviceRoleKey) return supabaseStorage();
  if (process.env.VERCEL) {
    throw new Error("Supabase Storage is not configured; local file storage is not persistent on Vercel.");
  }
  return localStorage();
}

export function storageFor(backend: "supabase" | "local"): EvidenceStorage {
  return backend === "supabase" ? supabaseStorage() : localStorage();
}
