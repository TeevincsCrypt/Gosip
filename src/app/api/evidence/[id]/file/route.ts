import { assertUuid, handler, HttpError } from "@/lib/http/api";
import { withActor } from "@/lib/db/context";
import { storageFor } from "@/lib/storage";

/** Authorised evidence download. RLS ensures only staff can resolve the storage path. */
export const GET = handler<{ id: string }>(
  async (_req, { actor }, { id }) => {
    assertUuid(id);
    const [row] = await withActor(actor, (tx) => tx<{ storage_backend: "supabase" | "local"; storage_path: string; mime_type: string }[]>`
      select storage_backend, storage_path, mime_type from public.evidence where id = ${id}`);
    if (!row) throw new HttpError(404, "Evidence not found");
    const data = await storageFor(row.storage_backend).get(row.storage_path);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": row.mime_type,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  },
  { require: "staff" },
);
