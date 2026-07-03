import React from "react";

export function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[var(--color-text)]">
        <span className="text-[var(--color-accent-hover)]">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

export function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input className="input" type="number" value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <button type="button" className="flex items-center justify-between gap-2 text-xs text-left group" onClick={() => onChange(!checked)}>
      <span className="flex items-center gap-1.5 text-[var(--color-text-dim)] group-hover:text-[var(--color-text)]">
        {icon}{label}
      </span>
      <span className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-3)]"}`}>
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

export function Check({ checked }: { checked: boolean }) {
  return (
    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${checked ? "bg-[var(--color-accent)] text-white" : "border border-[var(--color-border-strong)]"}`}>
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </span>
  );
}
