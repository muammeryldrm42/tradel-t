"use client";
import { X, AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import type { Alert } from "../../store/index";
import { useDashboardStore } from "../../store/index";

const icons = {
  info:    <Info size={14} />,
  warning: <AlertTriangle size={14} />,
  error:   <XCircle size={14} />,
  success: <CheckCircle size={14} />,
};
const colors = {
  info:    "border-[--accent-primary] bg-[--accent-subtle] text-[--accent-primary]",
  warning: "border-[--yellow] bg-[--yellow-subtle] text-[--yellow]",
  error:   "border-[--red] bg-[--red-subtle] text-[--red]",
  success: "border-[--green] bg-[--green-subtle] text-[--green]",
};

export function AlertBanner({ alert }: { alert: Alert }) {
  const dismiss = useDashboardStore((s) => s.dismissAlert);
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm animate-fadeIn ${colors[alert.type]}`}>
      {icons[alert.type]}
      <div className="flex-1 min-w-0">
        <span className="font-medium">{alert.title}: </span>
        <span className="opacity-80">{alert.message}</span>
      </div>
      <button onClick={() => dismiss(alert.id)} className="opacity-60 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────
interface StatusBadgeProps {
  status: string;
}

const statusMap: Record<string, string> = {
  RUNNING:               "text-[--green] border-[--green]/30 bg-[--green-subtle]",
  STOPPED:               "text-[--text-muted] border-[--border-subtle]",
  STARTING:              "text-[--yellow] border-[--yellow]/30 bg-[--yellow-subtle]",
  PAUSED:                "text-[--yellow] border-[--yellow]/30 bg-[--yellow-subtle]",
  ERROR:                 "text-[--red] border-[--red]/30 bg-[--red-subtle]",
  KILL_SWITCH_ACTIVE:    "text-[--red] border-[--red]/30 bg-[--red-subtle]",
  CIRCUIT_BREAKER_TRIPPED: "text-[--red] border-[--red]/30 bg-[--red-subtle]",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${statusMap[status] ?? "text-[--text-muted] border-[--border-subtle]"}`}>
      {status}
    </span>
  );
}
