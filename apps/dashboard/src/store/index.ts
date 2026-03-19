import { create } from "zustand";
import type { BotStateResponse } from "../lib/api";

interface DashboardStore {
  // Bot state
  botState: BotStateResponse["botState"] | null;
  paperSummary: BotStateResponse["paperSummary"] | null;
  riskState: BotStateResponse["riskState"] | null;
  setBotData: (data: BotStateResponse) => void;

  // WS connection
  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;

  // Selected symbol
  selectedSymbol: "BTC" | "ETH" | "SOL";
  setSelectedSymbol: (s: "BTC" | "ETH" | "SOL") => void;

  // Alerts
  alerts: Alert[];
  addAlert: (a: Omit<Alert, "id" | "timestamp">) => void;
  dismissAlert: (id: string) => void;
}

export interface Alert {
  id: string;
  type: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  timestamp: number;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  botState: null,
  paperSummary: null,
  riskState: null,
  setBotData: (data) =>
    set({
      botState: data.botState,
      paperSummary: data.paperSummary,
      riskState: data.riskState,
    }),

  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  selectedSymbol: "BTC",
  setSelectedSymbol: (s) => set({ selectedSymbol: s }),

  alerts: [],
  addAlert: (a) =>
    set((state) => ({
      alerts: [
        ...state.alerts,
        { ...a, id: Math.random().toString(36).slice(2), timestamp: Date.now() },
      ].slice(-10),
    })),
  dismissAlert: (id) =>
    set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
}));
