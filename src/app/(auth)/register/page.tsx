"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/utils";
import { Button, Field, Input } from "@/components/ui/primitives";

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ displayName: "", email: "", password: "", organization: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
          await api("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
          await qc.invalidateQueries();
          router.push("/dashboard");
        } catch (err) {
          const issues = ((err as ApiError).body as { issues?: { message: string }[] })?.issues;
          setError(issues?.map((i) => i.message).join(" · ") ?? (err as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <h1 className="text-lg font-semibold">Create an account</h1>
      <p className="text-xs text-muted">Accounts let you follow your own reports. Reviewer roles are granted by administrators.</p>
      <Field label="Name"><Input value={form.displayName} onChange={set("displayName")} required maxLength={80} /></Field>
      <Field label="Email"><Input type="email" autoComplete="email" value={form.email} onChange={set("email")} required /></Field>
      <Field label="Password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={10} /></Field>
      <Field label="Organisation (optional)"><Input value={form.organization} onChange={set("organization")} maxLength={120} /></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" loading={loading}>Create account</Button>
      <p className="text-center text-xs text-muted">Already registered? <Link href="/login" className="text-accent hover:underline">Sign in</Link></p>
    </form>
  );
}
