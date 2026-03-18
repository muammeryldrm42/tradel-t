"use client";

import { useEffect, useRef } from "react";
import { useDashboardStore } from "../store/index.js";
import type { BotStateResponse } from "../lib/api.js";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

export function useLiveUpdates() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setBotData, setWsConnected, addAlert } = useDashboardStore();

  useEffect(() => {
    let attempts = 0;

    function connect() {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          attempts = 0;
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as {
              type: string;
              botState?: BotStateResponse["botState"];
              paperSummary?: BotStateResponse["paperSummary"];
              riskState?: BotStateResponse["riskState"];
            };

            if (msg.type === "state_update" && msg.botState && msg.paperSummary && msg.riskState) {
              setBotData({
                botState: msg.botState,
                paperSummary: msg.paperSummary,
                riskState: msg.riskState,
              });

              // Alert on kill switch
              if (msg.botState.killSwitchActive) {
                addAlert({ type: "error", title: "Kill Switch Active", message: "All trading is halted. Manual reset required." });
              }
              if (msg.botState.circuitBreakerTripped) {
                addAlert({ type: "warning", title: "Circuit Breaker Tripped", message: msg.botState.error ?? "Consecutive losses exceeded threshold." });
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          setWsConnected(false);
          wsRef.current = null;
          const delay = Math.min(1000 * Math.pow(2, attempts), 30_000);
          attempts++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {}
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close(1000, "Component unmounted");
    };
  }, [setBotData, setWsConnected, addAlert]);

  return wsRef;
}
