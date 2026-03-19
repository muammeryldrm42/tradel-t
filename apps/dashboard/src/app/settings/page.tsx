"use client";
import { Sidebar } from "../../components/layout/Sidebar";
import { TopBar } from "../../components/layout/TopBar";
import { useDashboardStore } from "../../store/index";
import { useLiveUpdates } from "../../hooks/useLiveUpdates";

export default function Page() {
  useLiveUpdates();
  const wsConnected = useDashboardStore((s) => s.wsConnected);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="Dashboard" wsConnected={wsConnected} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="card p-8 text-center text-[--text-muted]">
            <p className="text-lg font-medium mb-2 text-[--text-primary]">Page</p>
            <p className="text-sm">Coming soon.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
