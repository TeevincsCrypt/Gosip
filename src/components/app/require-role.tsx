"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useSession } from "./providers";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";

/** UX guard only. Authorisation is enforced by the API and PostgreSQL RLS. */
export function RequireStaff({ children, what }: { children: React.ReactNode; what: string }) {
  const { user, isStaff, loading } = useSession();
  if (loading) return <div className="p-6"><Skeleton className="h-40" /></div>;
  if (!isStaff) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Lock className="size-6" />}
          title={`${what} is restricted`}
          action={!user ? <Link href="/login"><Button variant="primary" size="sm">Sign in</Button></Link> : undefined}
        >
          {user
            ? "Your account does not have the analyst or administrator role. Access to sensitive evidence and review tools is limited to authorised reviewers."
            : "Sign in with an analyst or administrator account. Evidence files and review tools are never exposed publicly."}
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}
