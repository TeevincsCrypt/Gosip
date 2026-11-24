import { cn } from "@/lib/client/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="#111816" stroke="#26332c" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#9bcb8b" strokeWidth="1.4" opacity="0.5" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="#9bcb8b" strokeWidth="1.4" />
      <path d="M16 3v6M16 23v6M3 16h6M23 16h6" stroke="#9bcb8b" strokeWidth="1.4" />
      <circle cx="21.5" cy="11" r="1.6" fill="#e06b5f" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[0.18em] text-fg">GOS-IP</span>
        <span className="mt-1 hidden text-[9.5px] uppercase tracking-[0.14em] text-dim sm:block">Situational Intelligence</span>
      </span>
    </span>
  );
}
