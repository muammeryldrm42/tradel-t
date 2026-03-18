"use client";
import { Sidebar } from "../../components/layout/Sidebar.js";
import { TopBar } from "../../components/layout/TopBar.js";
import { useDashboardStore } from "../../store/index.js";
import { useLiveUpdates } from "../../hooks/useLiveUpdates.js";

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
            <p className="text-sm">Connect the API and database to see live data here.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
