"use client";
import { useState } from "react";
import { Power } from "lucide-react";

interface KillSwitchButtonProps {
  active: boolean;
  onActivate: () => Promise<void>;
  onDeactivate: () => Promise<void>;
}

export function KillSwitchButton({ active, onActivate, onDeactivate }: KillSwitchButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleClick = async () => {
    if (active) {
      setLoading(true);
      await onDeactivate().finally(() => setLoading(false));
      return;
    }
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    setLoading(true);
    await onActivate().finally(() => setLoading(false));
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border ${
        active
          ? "border-[--red] text-[--red] bg-[--red-subtle] kill-switch-active"
          : confirming
          ? "border-[--yellow] text-[--yellow] bg-[--yellow-subtle]"
          : "border-[--border-default] text-[--text-secondary] hover:border-[--red] hover:text-[--red]"
      }`}
    >
      <Power size={14} />
      {loading
        ? "..."
        : active
        ? "Kill Switch ACTIVE — Click to Reset"
        : confirming
        ? "Click again to confirm"
        : "Kill Switch"}
    </button>
  );
}
