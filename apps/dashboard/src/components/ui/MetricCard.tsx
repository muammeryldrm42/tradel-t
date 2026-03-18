// ─── MetricCard ───────────────────────────────────────────────────────────────
"use client";
import type { ReactNode } from "react";

interface MetricCardProps {
  icon?: ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  valueClass?: string;
}

export function MetricCard({ icon, label, value, subtitle, valueClass }: MetricCardProps) {
  return (
    <div className="card p-4 space-y-2 animate-fadeIn">
      <div className="flex items-center gap-1.5 text-[--text-muted]">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-xl font-semibold num-ticker ${valueClass ?? "text-[--text-primary]"}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-[--text-muted]">{subtitle}</div>
      )}
    </div>
  );
}
