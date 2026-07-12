import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./utils";

/** Shimmering placeholder block — use while async content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader2 className={cn("animate-[screc-spin_0.8s_linear_infinite]", className)} style={{ width: size, height: size }} />;
}

/** Wraps children in a fade-in reveal. `delay` in ms staggers entrances. */
export function FadeIn({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div className={cn("fade-in", className)} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/** A compact "loading" row used in lists/panels. */
export function LoadingRow({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-[var(--color-text-faint)]", className)}>
      <Spinner size={14} />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
