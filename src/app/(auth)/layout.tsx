import Link from "next/link";
import { Wordmark } from "@/components/app/brand";
import { EMERGENCY_DISCLAIMER } from "@/lib/domain/constants";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-backdrop flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8"><Wordmark /></Link>
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6">{children}</div>
      <p className="mt-6 max-w-sm text-center text-[11px] text-dim">{EMERGENCY_DISCLAIMER}</p>
    </div>
  );
}
