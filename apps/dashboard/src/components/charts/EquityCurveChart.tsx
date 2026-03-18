"use client";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { useDashboardStore } from "../../store/index.js";

// Dummy data while no trades exist
const PLACEHOLDER = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  equity: 10000 + (Math.random() - 0.48) * 100 * (i + 1),
}));

export function EquityCurveChart() {
  const paperSummary = useDashboardStore((s) => s.paperSummary);
  const initialBalance = 10_000;
  const currentBalance = parseFloat(paperSummary?.balance ?? "10000");

  const isPositive = currentBalance >= initialBalance;

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={PLACEHOLDER} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? "var(--green)" : "var(--red)"} stopOpacity={0.25} />
              <stop offset="95%" stopColor={isPositive ? "var(--green)" : "var(--red)"} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={4}
          />
          <YAxis
            tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
              fontSize: 12,
              color: "var(--text-primary)",
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, "Equity"]}
          />
          <ReferenceLine y={initialBalance} stroke="var(--border-strong)" strokeDasharray="4 2" />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={isPositive ? "var(--green)" : "var(--red)"}
            strokeWidth={1.5}
            fill="url(#equityGrad)"
            dot={false}
            activeDot={{ r: 3, fill: isPositive ? "var(--green)" : "var(--red)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
