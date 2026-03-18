"use client";
import { Wifi, WifiOff } from "lucide-react";

interface TopBarProps {
  title: string;
  wsConnected: boolean;
}

export function TopBar({ title, wsConnected }: TopBarProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-[--border-subtle] bg-[--bg-surface] flex-shrink-0">
      <h1 className="text-sm font-semibold text-[--text-primary]">{title}</h1>
      <div className="flex items-center gap-4 text-xs text-[--text-muted]">
        <span>{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
        <div className={`flex items-center gap-1.5 ${wsConnected ? "text-[--green]" : "text-[--red]"}`}>
          {wsConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{wsConnected ? "Live" : "Disconnected"}</span>
        </div>
      </div>
    </header>
  );
}
