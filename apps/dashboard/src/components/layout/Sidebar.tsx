// ─── Sidebar ──────────────────────────────────────────────────────────────────
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, TrendingUp, Activity, BookOpen, List,
  FlaskConical, Shield, Settings, FileText, Cpu,
} from "lucide-react";

const NAV = [
  { href: "/",           label: "Overview",    icon: LayoutDashboard },
  { href: "/markets",    label: "Markets",     icon: TrendingUp },
  { href: "/signals",    label: "Signals",     icon: Activity },
  { href: "/positions",  label: "Positions",   icon: BookOpen },
  { href: "/orders",     label: "Orders",      icon: List },
  { href: "/backtests",  label: "Backtests",   icon: FlaskConical },
  { href: "/risk",       label: "Risk",        icon: Shield },
  { href: "/settings",   label: "Settings",    icon: Settings },
  { href: "/audit",      label: "Audit Log",   icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 flex-shrink-0 border-r border-[--border-subtle] bg-[--bg-surface] flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-[--border-subtle]">
        <Cpu size={18} className="text-[--accent-primary]" />
        <span className="font-semibold text-sm tracking-tight">
          Lighter<span className="text-[--accent-primary]">Bot</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-0.5 px-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-[--accent-subtle] text-[--accent-primary]"
                      : "text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--bg-hover]"
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Mode badge */}
      <div className="p-4 border-t border-[--border-subtle]">
        <div className="text-xs text-center text-[--yellow] font-mono font-medium py-1.5 px-3 rounded border border-[--yellow]/30 bg-[--yellow-subtle]">
          SIMULATION MODE
        </div>
      </div>
    </aside>
  );
}
