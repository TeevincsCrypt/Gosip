import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/gosip_test";
process.env.SESSION_SECRET = "test-session-secret-0123456789-abcdefghij";
process.env.FINGERPRINT_SECRET = "test-fingerprint-secret";
process.env.LOCAL_UPLOAD_DIR = path.join(os.tmpdir(), "gosip-test-uploads");
// Tests must never call a real AI provider.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
