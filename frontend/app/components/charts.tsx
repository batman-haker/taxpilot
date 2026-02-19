"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Line,
} from "recharts";

const C = {
  profit: "#10b981",
  loss: "#ef4444",
  accent: "#3b82f6",
  amber: "#f59e0b",
  neutral: "#475569",
  axis: "#94a3b8",
  grid: "#1e293b66",
  tipBg: "#111827",
  tipBorder: "#1e293b",
  text: "#f1f5f9",
};

const MONTHS_PL = ["Sty","Lut","Mar","Kwi","Maj","Cze","Lip","Sie","Wrz","Paz","Lis","Gru"];

function formatPLN(v: number) {
  return v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " PLN";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function DarkTooltip({ active, payload, label, suffix }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 shadow-xl text-sm border"
         style={{ background: C.tipBg, borderColor: C.tipBorder, color: C.text }}>
      <p className="text-xs mb-1" style={{ color: C.axis }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || C.text }}>
          {p.name}: {suffix === "%" ? `${p.value}%` : formatPLN(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Chart 1: Monthly P&L Timeline ──────────────────────────────────

interface MonthlyPnlChartProps {
  data: Array<{ month: string; profit: number; cumulative: number }>;
}

export function MonthlyPnlChart({ data }: MonthlyPnlChartProps) {
  if (data.length < 1) return null;

  const chartData = data.map((d) => {
    const [, m] = d.month.split("-");
    return { ...d, label: MONTHS_PL[parseInt(m, 10) - 1] || d.month };
  });

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} />
          <YAxis
            yAxisId="bar"
            tick={{ fill: C.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            yAxisId="line"
            orientation="right"
            tick={{ fill: C.accent, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<DarkTooltip />} />
          <Bar yAxisId="bar" dataKey="profit" name="Miesiac" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.profit >= 0 ? C.profit : C.loss} />
            ))}
          </Bar>
          <Line
            yAxisId="line"
            type="monotone"
            dataKey="cumulative"
            name="Narastajaco"
            stroke={C.accent}
            strokeWidth={2}
            dot={{ fill: C.accent, r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Chart 2: Win/Loss Donut ────────────────────────────────────────

interface WinLossDonutProps {
  wins: number;
  losses: number;
  breakeven: number;
}

export function WinLossDonut({ wins, losses, breakeven }: WinLossDonutProps) {
  const total = wins + losses + breakeven;
  if (total === 0) return null;
  const winRate = Math.round((wins / total) * 100);

  const data = [
    { name: "Zyskowne", value: wins, color: C.profit },
    { name: "Stratne", value: losses, color: C.loss },
    ...(breakeven > 0 ? [{ name: "Neutralne", value: breakeven, color: C.neutral }] : []),
  ];

  return (
    <div className="h-[280px] w-full flex flex-col items-center">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} stroke="none" />
            ))}
          </Pie>
          <Tooltip content={<DarkTooltip suffix="szt" />} />
          {/* Center label */}
          <text x="50%" y="46%" textAnchor="middle" fill={C.text} fontSize={28} fontWeight="bold">
            {winRate}%
          </text>
          <text x="50%" y="58%" textAnchor="middle" fill={C.axis} fontSize={12}>
            win rate
          </text>
        </PieChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs mt-1">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.profit }} /> {wins} zyskownych
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.loss }} /> {losses} stratnych
        </span>
        {breakeven > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.neutral }} /> {breakeven} neutralnych
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Chart 3: Symbol P&L Horizontal Bars ────────────────────────────

interface SymbolPnlChartProps {
  data: Array<{ symbol: string; broker: string; profit: number }>;
}

export function SymbolPnlChart({ data }: SymbolPnlChartProps) {
  if (data.length < 2) return null;

  const chartData = [...data]
    .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
    .slice(0, 10)
    .reverse();

  return (
    <div style={{ height: Math.max(200, chartData.length * 32 + 40) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={chartData} margin={{ left: 5, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }}
                 tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <YAxis type="category" dataKey="symbol" tick={{ fill: C.axis, fontSize: 11 }} width={90} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="profit" name="Zysk/strata" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.profit >= 0 ? C.profit : C.loss} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Chart 4: Dividend Horizontal Bars ──────────────────────────────

interface DividendChartProps {
  data: Array<{ symbol: string; broker: string; gross: number }>;
}

export function DividendChart({ data }: DividendChartProps) {
  if (data.length < 2) return null;

  const chartData = [...data].slice(0, 10).reverse();

  return (
    <div style={{ height: Math.max(200, chartData.length * 32 + 40) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={chartData} margin={{ left: 5, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }}
                 tickFormatter={(v) => formatPLN(v)} />
          <YAxis type="category" dataKey="symbol" tick={{ fill: C.axis, fontSize: 11 }} width={90} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="gross" name="Brutto PLN" fill={C.amber} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
