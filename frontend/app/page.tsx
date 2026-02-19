"use client";

import { useState, useRef, useCallback, useMemo, DragEvent, ChangeEvent } from "react";
import { MonthlyPnlChart, WinLossDonut, SymbolPnlChart, DividendChart } from "@/app/components/charts";

// ---------------------------------------------------------------------------
// Types matching the backend response
// ---------------------------------------------------------------------------

interface FileSummary {
  filename: string;
  broker: string;
  transactions_count: number;
  buys: number;
  sells: number;
  dividends: number;
  wht: number;
  note?: string;
}

interface FifoMatch {
  symbol: string;
  quantity: string;
  buy_date: string;
  buy_settlement_date: string;
  buy_price: string;
  buy_currency: string;
  buy_commission: string;
  buy_nbp_rate: string;
  buy_cost_pln: string;
  sell_date: string;
  sell_settlement_date: string;
  sell_price: string;
  sell_currency: string;
  sell_commission: string;
  sell_nbp_rate: string;
  sell_revenue_pln: string;
  profit_pln: string;
  is_orphan?: boolean;
  broker?: string;
}

interface DividendItem {
  symbol: string;
  isin: string | null;
  country: string | null;
  pay_date: string;
  currency: string;
  gross_amount: string;
  gross_amount_pln: string;
  nbp_rate: string;
  wht_amount: string;
  wht_amount_pln: string;
  wht_nbp_rate: string;
  polish_tax_due: string;
  tax_to_pay_poland: string;
  broker?: string;
}

interface CapitalGainsSummary {
  revenue_pln: string;
  costs_pln: string;
  profit_pln: string;
  tax_due: string;
  matches: FifoMatch[];
}

interface DividendSummary {
  total_gross_pln: string;
  total_wht_pln: string;
  total_polish_tax_due: string;
  total_to_pay_pln: string;
  items: DividendItem[];
}

interface CountryBreakdown {
  country_code: string;
  country_name: string;
  capital_gains_pln: string;
  dividend_income_pln: string;
  tax_paid_abroad_pln: string;
}

interface OpenPosition {
  symbol: string;
  quantity: string;
  buy_date: string;
  buy_price: string;
  currency: string;
  cost_pln: string;
  nbp_rate: string;
  broker?: string;
}

interface ShortPosition {
  symbol: string;
  quantity: string;
  sell_date: string;
  sell_price: string;
  currency: string;
  revenue_pln: string;
  nbp_rate: string;
  broker?: string;
}

interface YearSummary {
  year: number;
  revenue_pln: string;
  costs_pln: string;
  profit_pln: string;
  tax_19_pln: string;
  dividends_gross_pln: string;
  dividends_wht_pln: string;
  dividends_tax_to_pay_pln: string;
  num_trades: number;
}

interface SymbolLifetimeSummary {
  symbol: string;
  total_bought_qty: string;
  total_sold_qty: string;
  remaining_qty: string;
  avg_buy_price: string;
  currency: string;
  total_buy_cost_pln: string;
  total_sell_revenue_pln: string;
  realized_pnl_pln: string;
  dividends_pln: string;
  first_trade_date: string;
  last_trade_date: string;
  trades_count: number;
}

interface PortfolioMetrics {
  total_invested_pln: string;
  total_revenue_pln: string;
  total_realized_profit_pln: string;
  total_commissions_pln: string;
  total_dividends_gross_pln: string;
  total_wht_paid_pln: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  breakeven_trades: number;
  win_rate_percent: string;
  avg_profit_per_trade_pln: string;
  avg_holding_period_days: string;
  account_age_days: number;
  first_trade_date: string;
  last_trade_date: string;
  unique_symbols_traded: number;
}

interface PortfolioReport {
  year_summaries: YearSummary[];
  symbol_summaries: SymbolLifetimeSummary[];
  metrics: PortfolioMetrics;
}

interface TaxReport {
  tax_year: number;
  capital_gains: CapitalGainsSummary;
  dividends: DividendSummary;
  pit_zg: CountryBreakdown[];
  open_positions: OpenPosition[];
  open_short_positions: ShortPosition[];
  warnings: string[];
  portfolio: PortfolioReport | null;
}

interface ApiResponse {
  files: FileSummary[];
  report: TaxReport;
}

interface ManualBuy {
  symbol: string;
  tradeDate: string;
  quantity: string;
  price: string;
  currency: string;
  commission: string;
}

// ---------------------------------------------------------------------------
// Portfolio Analysis types (IBKR Performance Report)
// ---------------------------------------------------------------------------

interface PAKeyStatistics {
  beginning_nav: string;
  ending_nav: string;
  cumulative_return_pct: string;
  best_return_pct: string;
  best_return_date: string | null;
  worst_return_pct: string;
  worst_return_date: string | null;
  mtm: string;
  deposits_withdrawals: string;
  dividends: string;
  interest: string;
  fees: string;
}

interface PAMonthlyReturn {
  period: string;
  period_type: string;
  return_pct: string | null;
}

interface PAOpenPosition {
  symbol: string;
  description: string;
  financial_instrument: string | null;
  currency: string | null;
  sector: string | null;
  quantity: string;
  close_price: string;
  value: string;
  cost_basis: string;
  unrealized_pnl: string;
}

interface PATradeSummary {
  financial_instrument: string | null;
  currency: string | null;
  symbol: string;
  description: string;
  sector: string | null;
  quantity_bought: string;
  avg_buy_price: string;
  proceeds_bought: string;
  quantity_sold: string;
  avg_sell_price: string;
  proceeds_sold: string;
}

interface PADeposit {
  entry_date: string;
  account: string;
  deposit_type: string;
  description: string;
  amount: string;
}

interface PADividendItem {
  pay_date: string;
  ex_date: string | null;
  account: string;
  symbol: string;
  note: string | null;
  quantity: string;
  dividend_per_share: string;
  amount: string;
}

interface PASymbolPerformance {
  symbol: string;
  description: string;
  financial_instrument: string;
  sector: string | null;
  avg_weight_pct: string;
  return_pct: string;
  contribution_pct: string;
  unrealized_pnl: string;
  realized_pnl: string;
  is_open: boolean;
}

interface PADailyNav {
  nav_date: string;
  nav: string;
}

interface PACumulativeReturn {
  return_date: string;
  cumulative_return_pct: string;
}

interface PortfolioAnalysisReport {
  account_name: string;
  period_start: string;
  period_end: string;
  base_currency: string;
  key_statistics: PAKeyStatistics;
  monthly_returns: PAMonthlyReturn[];
  open_positions: PAOpenPosition[];
  trade_summaries: PATradeSummary[];
  deposits: PADeposit[];
  dividends_list: PADividendItem[];
  symbol_performance: PASymbolPerformance[];
  daily_nav: PADailyNav[];
  cumulative_returns: PACumulativeReturn[];
  warnings: string[];
}

interface PAApiResponse {
  filename: string;
  report: PortfolioAnalysisReport;
}

interface IkeIkzePosition {
  account_type: string;
  symbol: string;
  exchange: string;
  currency: string;
  country: string | null;
  quantity: string;
  avg_buy_price: string;
  current_price: string;
  change_pct: string;
  pnl_pln: string;
  market_value_pln: string;
}

interface IkeIkzeReport {
  positions: IkeIkzePosition[];
  warnings: string[];
}

interface IkeIkzeApiResponse {
  filename: string;
  report: IkeIkzeReport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPLN(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatNumber(value: string | number, decimals = 2): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "-";
  const d = new Date(isoDate);
  return d.toLocaleDateString("pl-PL");
}

function profitColor(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num > 0) return "text-emerald-400";
  if (num < 0) return "text-red-400";
  return "text-slate-400";
}

function formatUSD(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatPct(value: string | number | null): string {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return num.toFixed(2) + "%";
}

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 1 - i);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomePage() {
  // Form state
  const [ibkrFiles, setIbkrFiles] = useState<File[]>([]);
  const [exanteFiles, setExanteFiles] = useState<File[]>([]);
  const [taxYear, setTaxYear] = useState<number>(currentYear - 1);
  const [priorYearLoss, setPriorYearLoss] = useState<string>("");
  const [isDraggingIbkr, setIsDraggingIbkr] = useState(false);
  const [isDraggingExante, setIsDraggingExante] = useState(false);
  const [manualBuys, setManualBuys] = useState<ManualBuy[]>([]);

  // Result state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  // Expandable sections
  const [showFifoDetail, setShowFifoDetail] = useState(false);
  const [showDividendDetail, setShowDividendDetail] = useState(false);
  const [showCapGainsInfo, setShowCapGainsInfo] = useState(false);
  const [showDividendInfo, setShowDividendInfo] = useState(false);
  const [showMethodologyInfo, setShowMethodologyInfo] = useState(false);

  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showFormGuide, setShowFormGuide] = useState(false);
  const [showPortfolioReport, setShowPortfolioReport] = useState(false);

  // Education sections
  const [showEdu, setShowEdu] = useState(false);
  const [eduSection, setEduSection] = useState<string | null>(null);
  const [showIbkrHelp, setShowIbkrHelp] = useState(false);
  const [showExanteHelp, setShowExanteHelp] = useState(false);

  // Portfolio Analysis state (IBKR Performance Report)
  const [paLoading, setPaLoading] = useState(false);
  const [paError, setPaError] = useState<string | null>(null);
  const [paResult, setPaResult] = useState<PAApiResponse | null>(null);
  const [showPaPositions, setShowPaPositions] = useState(false);
  const [showPaDividends, setShowPaDividends] = useState(false);
  const [showPaDeposits, setShowPaDeposits] = useState(false);
  const [showPaReturns, setShowPaReturns] = useState(false);
  const [showPaSymbolPerf, setShowPaSymbolPerf] = useState(false);
  const [showPaTrades, setShowPaTrades] = useState(false);

  // IKE/IKZE state
  const [ikeFiles, setIkeFiles] = useState<File[]>([]);
  const [isDraggingIke, setIsDraggingIke] = useState(false);
  const [ikeLoading, setIkeLoading] = useState(false);
  const [ikeError, setIkeError] = useState<string | null>(null);
  const [ikeResult, setIkeResult] = useState<IkeIkzeApiResponse | null>(null);

  const ibkrFileInputRef = useRef<HTMLInputElement>(null);
  const exanteFileInputRef = useRef<HTMLInputElement>(null);
  const ikeFileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const paResultsRef = useRef<HTMLDivElement>(null);

  // ---- Computed analytics ----
  const analytics = useMemo(() => {
    if (!result) return null;
    const matches = result.report.capital_gains.matches;
    const divItems = result.report.dividends.items;

    // P&L per symbol+broker
    const symbolPnl: Record<string, { symbol: string; broker: string; revenue: number; cost: number; profit: number; trades: number }> = {};
    for (const m of matches) {
      const key = `${m.symbol}|${m.broker || "?"}`;
      if (!symbolPnl[key]) symbolPnl[key] = { symbol: m.symbol, broker: m.broker || "?", revenue: 0, cost: 0, profit: 0, trades: 0 };
      symbolPnl[key].revenue += parseFloat(m.sell_revenue_pln);
      symbolPnl[key].cost += parseFloat(m.buy_cost_pln);
      symbolPnl[key].profit += parseFloat(m.profit_pln);
      symbolPnl[key].trades += 1;
    }
    const symbolPnlList = Object.values(symbolPnl)
      .sort((a, b) => b.profit - a.profit);

    // Best / worst trades (top 5 each)
    const sortedByProfit = [...matches].sort(
      (a, b) => parseFloat(b.profit_pln) - parseFloat(a.profit_pln)
    );
    const bestTrades = sortedByProfit.slice(0, 5);
    const worstTrades = sortedByProfit.slice(-5).reverse();

    // Total commissions
    const totalBuyCommission = matches.reduce((s, m) => s + parseFloat(m.buy_commission), 0);
    const totalSellCommission = matches.reduce((s, m) => s + parseFloat(m.sell_commission), 0);

    // Dividend per symbol+broker
    const divBySymbol: Record<string, { symbol: string; broker: string; gross: number; wht: number; toPay: number; count: number }> = {};
    for (const d of divItems) {
      const key = `${d.symbol}|${d.broker || "?"}`;
      if (!divBySymbol[key]) divBySymbol[key] = { symbol: d.symbol, broker: d.broker || "?", gross: 0, wht: 0, toPay: 0, count: 0 };
      divBySymbol[key].gross += parseFloat(d.gross_amount_pln);
      divBySymbol[key].wht += parseFloat(d.wht_amount_pln);
      divBySymbol[key].toPay += parseFloat(d.tax_to_pay_poland);
      divBySymbol[key].count += 1;
    }
    const divBySymbolList = Object.values(divBySymbol)
      .sort((a, b) => b.gross - a.gross);

    // Currency breakdown
    const currencyStats: Record<string, { buys: number; sells: number; volume: number }> = {};
    for (const m of matches) {
      const c = m.buy_currency;
      if (!currencyStats[c]) currencyStats[c] = { buys: 0, sells: 0, volume: 0 };
      currencyStats[c].buys += 1;
      currencyStats[c].sells += 1;
      currencyStats[c].volume += parseFloat(m.sell_revenue_pln) + parseFloat(m.buy_cost_pln);
    }

    // General stats
    const totalTrades = matches.length;
    const profitableTrades = matches.filter((m) => parseFloat(m.profit_pln) > 0).length;
    const lossTrades = matches.filter((m) => parseFloat(m.profit_pln) < 0).length;
    const avgProfit = totalTrades > 0
      ? matches.reduce((s, m) => s + parseFloat(m.profit_pln), 0) / totalTrades
      : 0;
    const uniqueSymbols = new Set(matches.map((m) => m.symbol)).size;

    // Monthly P&L timeline
    const monthlyPnl: Record<string, number> = {};
    for (const m of matches) {
      const d = new Date(m.sell_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyPnl[key] = (monthlyPnl[key] || 0) + parseFloat(m.profit_pln);
    }
    const monthlyPnlList: Array<{ month: string; profit: number; cumulative: number }> = Object.entries(monthlyPnl)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, profit]) => ({ month, profit, cumulative: 0 }));
    let cumulative = 0;
    for (const entry of monthlyPnlList) {
      cumulative += entry.profit;
      entry.cumulative = cumulative;
    }

    return {
      symbolPnlList,
      bestTrades,
      worstTrades,
      totalBuyCommission,
      totalSellCommission,
      divBySymbolList,
      currencyStats,
      totalTrades,
      profitableTrades,
      lossTrades,
      avgProfit,
      uniqueSymbols,
      monthlyPnlList,
    };
  }, [result]);

  // ---- Drag & Drop handlers (per broker) ----

  const filterCsvFiles = (fileList: FileList) =>
    Array.from(fileList).filter(
      (f) =>
        f.name.endsWith(".csv") ||
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls")
    );

  const makeDragHandlers = (
    setDragging: (v: boolean) => void,
    setFiles: React.Dispatch<React.SetStateAction<File[]>>
  ) => ({
    onDragEnter: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true); },
    onDragLeave: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false); },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); },
    onDrop: (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDragging(false);
      const dropped = filterCsvFiles(e.dataTransfer.files);
      if (dropped.length > 0) { setFiles((prev) => [...prev, ...dropped]); setError(null); }
    },
  });

  const ibkrDrag = useMemo(() => makeDragHandlers(setIsDraggingIbkr, setIbkrFiles), []);
  const exanteDrag = useMemo(() => makeDragHandlers(setIsDraggingExante, setExanteFiles), []);
  const ikeDrag = useMemo(() => makeDragHandlers(setIsDraggingIke, setIkeFiles), []);

  const handleIbkrFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { setIbkrFiles((prev) => [...prev, ...Array.from(e.target.files!)]); setError(null); }
  }, []);

  const handleExanteFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { setExanteFiles((prev) => [...prev, ...Array.from(e.target.files!)]); setError(null); }
  }, []);

  const handleIkeFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { setIkeFiles((prev) => [...prev, ...Array.from(e.target.files!)]); setIkeError(null); }
  }, []);

  const removeIbkrFile = useCallback((index: number) => {
    setIbkrFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeExanteFile = useCallback((index: number) => {
    setExanteFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeIkeFile = useCallback((index: number) => {
    setIkeFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Combined files for backward compat
  const files = useMemo(() => [...ibkrFiles, ...exanteFiles], [ibkrFiles, exanteFiles]);

  // ---- Manual buy handlers ----

  const addManualBuy = () => {
    setManualBuys((prev) => [
      ...prev,
      { symbol: "", tradeDate: "", quantity: "", price: "", currency: "USD", commission: "0" },
    ]);
  };

  const removeManualBuy = (index: number) => {
    setManualBuys((prev) => prev.filter((_, i) => i !== index));
  };

  const updateManualBuy = (index: number, field: keyof ManualBuy, value: string) => {
    setManualBuys((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  // ---- Submit ----

  const handleCalculate = async () => {
    if (files.length === 0) {
      setError("Nie wybrano plikow. Przeciagnij pliki CSV/XLSX z brokera.");
      return;
    }

    setLoading(true);
    setError(null);
    setPaError(null);
    setResult(null);

    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("tax_year", String(taxYear));
    if (priorYearLoss && parseFloat(priorYearLoss) > 0) {
      formData.append("prior_year_loss", priorYearLoss);
    }
    const validManualBuys = manualBuys.filter(
      (b) => b.symbol.trim() && b.tradeDate && b.quantity && b.price
    );
    if (validManualBuys.length > 0) {
      formData.append("manual_buys", JSON.stringify(validManualBuys));
    }

    try {
      const response = await fetch("http://localhost:8000/api/calculate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Blad serwera (${response.status})`
        );
      }

      const data: ApiResponse = await response.json();
      setResult(data);

      // Scroll to results
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nieoczekiwany blad. Sprawdz czy backend jest uruchomiony."
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePortfolioAnalysis = async () => {
    if (files.length === 0) {
      setPaError("Nie wybrano plikow. Przeciagnij plik CSV z raportu IBKR Performance.");
      return;
    }
    setPaLoading(true);
    setPaError(null);
    setPaResult(null);

    const formData = new FormData();
    formData.append("file", files[0]);

    try {
      const response = await fetch("http://localhost:8000/api/portfolio-analysis", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Blad serwera (${response.status})`);
      }
      const data: PAApiResponse = await response.json();
      setPaResult(data);
      setTimeout(() => {
        paResultsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      setPaError(err instanceof Error ? err.message : "Nieoczekiwany blad.");
    } finally {
      setPaLoading(false);
    }
  };

  const handleIkeIkzeUpload = async () => {
    if (ikeFiles.length === 0) {
      setIkeError("Nie wybrano pliku. Przeciagnij arkusz CSV z IKE/IKZE.");
      return;
    }
    setIkeLoading(true);
    setIkeError(null);
    setIkeResult(null);

    const formData = new FormData();
    formData.append("file", ikeFiles[0]);

    try {
      const response = await fetch("http://localhost:8000/api/ike-ikze", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Blad serwera (${response.status})`);
      }
      const data: IkeIkzeApiResponse = await response.json();
      setIkeResult(data);
    } catch (err) {
      setIkeError(err instanceof Error ? err.message : "Nieoczekiwany blad.");
    } finally {
      setIkeLoading(false);
    }
  };

  // ---- Render ----

  return (
    <div className="min-h-screen flex flex-col">
      {/* ================================================================
          HEADER
          ================================================================ */}
      <header className="border-b border-slate-800 bg-[#0d1117]">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center gap-4">
          {/* Logo icon */}
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              TaxPilot
            </h1>
            <p className="text-sm text-slate-400">
              Kalkulator podatku gieldowego PIT-38
            </p>
          </div>
        </div>
      </header>

      {/* ================================================================
          MAIN CONTENT
          ================================================================ */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10 space-y-8">
        {/* ---- Upload section ---- */}
        <section className="card space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              1. Wgraj pliki z brokera
            </h2>
            <p className="text-sm text-slate-400">
              Wgraj pliki z kazdego brokera do odpowiedniego pola
            </p>
            <div className="mt-3 rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 space-y-2">
              <p className="text-xs text-blue-300">
                <span className="font-semibold">Wgraj pliki z WSZYSTKICH lat</span> — od otwarcia konta do dzis.
                System potrzebuje pelnej historii kupna, aby prawidlowo dopasowac transakcje metoda FIFO.
                Rok podatkowy wybierzesz w kroku 2 — wynik bedzie obliczony tylko za ten rok.
              </p>
              <p className="text-xs text-blue-300/80">
                <span className="font-medium">IBKR:</span> Flex Query pozwala na max 365 dni na plik — wygeneruj osobne pliki za kazdy rok
                (np. akcje_23.csv, akcje_24.csv, akcje_25.csv + dywidendy za kazdy rok). Wgraj wszystkie naraz.
              </p>
              <p className="text-xs text-indigo-300/80">
                <span className="font-medium">Brak starych plikow?</span> Wgraj raport Performance/Portfolio Analyst
                razem z Activity Statement — system automatycznie uzupelni brakujace historyczne kupna
                srednia cena z raportu Performance.
              </p>
            </div>
          </div>

          {/* Two broker drop zones side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* IBKR zone */}
            <div className="space-y-3">
              <div
                {...ibkrDrag}
                onClick={() => ibkrFileInputRef.current?.click()}
                className={`
                  relative cursor-pointer rounded-xl border-2 border-dashed
                  transition-all duration-200
                  flex flex-col items-center justify-center py-8 px-4
                  ${
                    isDraggingIbkr
                      ? "drop-zone-active border-emerald-500 bg-emerald-500/5"
                      : "border-slate-700 hover:border-emerald-600 bg-slate-900/40 hover:bg-slate-900/70"
                  }
                `}
              >
                <input
                  ref={ibkrFileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls"
                  onChange={handleIbkrFileSelect}
                  className="hidden"
                />
                <svg
                  className={`w-10 h-10 mb-3 ${isDraggingIbkr ? "text-emerald-400" : "text-slate-500"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 4.5 4.5 0 013.09 8.362M12 9.75V3.75"
                  />
                </svg>
                <p className="text-sm text-emerald-300 font-semibold">Interactive Brokers</p>
                <p className="text-xs text-slate-400 mt-1">Flex Query / Activity Statement</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isDraggingIbkr ? "Upusc pliki..." : "Przeciagnij CSV lub kliknij"}
                </p>
              </div>
              {/* IBKR help toggle */}
              <button
                onClick={() => setShowIbkrHelp(!showIbkrHelp)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors mt-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
                Jak pobrac raport z IBKR?
                <svg className={`w-3 h-3 transition-transform ${showIbkrHelp ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {showIbkrHelp && (
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 text-xs text-slate-300 space-y-3">
                  <div>
                    <p className="font-semibold text-emerald-300 mb-1.5">Opcja 1: Flex Query (zalecane)</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li>Zaloguj sie do IBKR &rarr; <span className="text-slate-200">Performance &amp; Reports</span> &rarr; <span className="text-slate-200">Flex Queries</span></li>
                      <li>Kliknij <span className="text-slate-200">&quot;+&quot;</span> aby utworzyc nowy Flex Query</li>
                      <li>Wybierz sekcje: <span className="text-slate-200">Trades</span>, <span className="text-slate-200">Dividends</span>, <span className="text-slate-200">Withholding Tax</span>, <span className="text-slate-200">Transfers</span></li>
                      <li>Format: <span className="text-slate-200">CSV</span>, Period: od otwarcia konta do dzis</li>
                      <li>Pobierz i wgraj wszystkie pliki naraz</li>
                    </ol>
                    <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-1.5 text-amber-300">
                      Max 365 dni na plik — wygeneruj osobne pliki za kazdy rok (np. akcje_23.csv, akcje_24.csv, akcje_25.csv)
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-300 mb-1.5">Opcja 2: Activity Statement</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li><span className="text-slate-200">Reports</span> &rarr; <span className="text-slate-200">Statements</span> &rarr; <span className="text-slate-200">Activity</span></li>
                      <li>Period: <span className="text-slate-200">Annual</span>, Format: <span className="text-slate-200">CSV</span></li>
                      <li>Zawiera trades + dividends + WHT w jednym pliku</li>
                      <li>Wygeneruj za kazdy rok osobno i wgraj wszystkie</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-300 mb-1.5">Opcjonalnie: Performance Report</p>
                    <p className="text-slate-400"><span className="text-slate-200">Reports</span> &rarr; <span className="text-slate-200">Statements</span> &rarr; <span className="text-slate-200">Analyst / Performance</span>, Period: <span className="text-slate-200">Inception to Date</span>. Uzupelnia brakujace historyczne kupna srednia cena — wgraj razem z Flex Query.</p>
                  </div>
                </div>
              )}
              {ibkrFiles.length > 0 && (
                <div className="space-y-1.5">
                  {ibkrFiles.map((f, i) => (
                    <div key={`ibkr-${f.name}-${i}`} className="flex items-center justify-between bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-sm text-slate-200 truncate">{f.name}</span>
                        <span className="text-xs text-slate-500">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button onClick={() => removeIbkrFile(i)} className="text-slate-500 hover:text-red-400 transition-colors p-1" aria-label="Usun plik">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Exante zone */}
            <div className="space-y-3">
              <div
                {...exanteDrag}
                onClick={() => exanteFileInputRef.current?.click()}
                className={`
                  relative cursor-pointer rounded-xl border-2 border-dashed
                  transition-all duration-200
                  flex flex-col items-center justify-center py-8 px-4
                  ${
                    isDraggingExante
                      ? "drop-zone-active border-violet-500 bg-violet-500/5"
                      : "border-slate-700 hover:border-violet-600 bg-slate-900/40 hover:bg-slate-900/70"
                  }
                `}
              >
                <input
                  ref={exanteFileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls"
                  onChange={handleExanteFileSelect}
                  className="hidden"
                />
                <svg
                  className={`w-10 h-10 mb-3 ${isDraggingExante ? "text-violet-400" : "text-slate-500"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 4.5 4.5 0 013.09 8.362M12 9.75V3.75"
                  />
                </svg>
                <p className="text-sm text-violet-300 font-semibold">Exante</p>
                <p className="text-xs text-slate-400 mt-1">Custom report / historia transakcji</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isDraggingExante ? "Upusc pliki..." : "Przeciagnij CSV lub kliknij"}
                </p>
              </div>
              {/* Exante help toggle */}
              <button
                onClick={() => setShowExanteHelp(!showExanteHelp)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-400 transition-colors mt-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
                Jak pobrac raport z Exante?
                <svg className={`w-3 h-3 transition-transform ${showExanteHelp ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {showExanteHelp && (
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 text-xs text-slate-300 space-y-3">
                  <div>
                    <p className="font-semibold text-violet-300 mb-1.5">Custom Report (historia transakcji)</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li>Zaloguj sie do Exante &rarr; <span className="text-slate-200">Reports</span> &rarr; <span className="text-slate-200">Transaction Report</span></li>
                      <li>Zakres dat: <span className="text-slate-200">od otwarcia konta do dzis</span> (cala historia)</li>
                      <li>Typ transakcji: <span className="text-slate-200">All transactions</span> (wszystkie)</li>
                      <li>Format: <span className="text-slate-200">CSV</span></li>
                      <li>Kliknij <span className="text-slate-200">Generate</span> i pobierz plik</li>
                    </ol>
                  </div>
                  <div className="bg-violet-500/10 border border-violet-500/20 rounded px-3 py-1.5 text-violet-300">
                    Jesli masz wiele kont (np. FCP0101.001, WXS2094) — pobierz osobny plik z kazdego konta. System rozpoznaje oba formaty Exante automatycznie.
                  </div>
                </div>
              )}
              {exanteFiles.length > 0 && (
                <div className="space-y-1.5">
                  {exanteFiles.map((f, i) => (
                    <div key={`exa-${f.name}-${i}`} className="flex items-center justify-between bg-violet-900/20 border border-violet-800/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-sm text-slate-200 truncate">{f.name}</span>
                        <span className="text-xs text-slate-500">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button onClick={() => removeExanteFile(i)} className="text-slate-500 hover:text-red-400 transition-colors p-1" aria-label="Usun plik">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---- IKE/IKZE upload ---- */}
        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Arkusz CSV — IKE / IKZE (opcjonalnie)
            </h2>
            <p className="text-xs text-slate-400">
              Wgraj arkusz portfela z mBank eMakler. Konta IKE/IKZE sa zwolnione z podatku — dane sluza tylko do analizy portfela.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div
                {...ikeDrag}
                onClick={() => ikeFileInputRef.current?.click()}
                className={`
                  relative cursor-pointer rounded-xl border-2 border-dashed
                  transition-all duration-200
                  flex flex-col items-center justify-center py-8 px-4
                  ${
                    isDraggingIke
                      ? "drop-zone-active border-amber-500 bg-amber-500/5"
                      : "border-slate-700 hover:border-amber-600 bg-slate-900/40 hover:bg-slate-900/70"
                  }
                `}
              >
                <input
                  ref={ikeFileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleIkeFileSelect}
                  className="hidden"
                />
                <svg
                  className={`w-10 h-10 mb-3 ${isDraggingIke ? "text-amber-400" : "text-slate-500"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
                <p className="text-sm text-amber-300 font-semibold">IKE / IKZE</p>
                <p className="text-xs text-slate-400 mt-1">Arkusz CSV z mBank eMakler</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isDraggingIke ? "Upusc plik..." : "Przeciagnij CSV lub kliknij"}
                </p>
              </div>
              {ikeFiles.length > 0 && (
                <div className="space-y-1.5">
                  {ikeFiles.map((f, i) => (
                    <div key={`ike-${f.name}-${i}`} className="flex items-center justify-between bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-sm text-slate-200 truncate">{f.name}</span>
                        <span className="text-xs text-slate-500">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button onClick={() => removeIkeFile(i)} className="text-slate-500 hover:text-red-400 transition-colors p-1" aria-label="Usun plik">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-center">
              <button
                onClick={handleIkeIkzeUpload}
                disabled={ikeLoading || ikeFiles.length === 0}
                className={`
                  px-8 py-3 rounded-xl font-semibold text-sm tracking-wide
                  transition-all duration-200
                  ${
                    ikeLoading || ikeFiles.length === 0
                      ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                      : "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40"
                  }
                `}
              >
                {ikeLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="spinner w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Wczytywanie...
                  </span>
                ) : (
                  "Wczytaj portfel IKE/IKZE"
                )}
              </button>
            </div>
          </div>

          {ikeError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {ikeError}
            </div>
          )}

          {ikeResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Wczytano {ikeResult.report.positions.length} pozycji z {ikeResult.filename}
              </div>

              {/* IKE/IKZE summary cards */}
              {(() => {
                const ike = ikeResult.report.positions.filter(p => p.account_type === "IKE");
                const ikze = ikeResult.report.positions.filter(p => p.account_type === "IKZE");
                const ikeTotal = ike.reduce((s, p) => s + parseFloat(p.market_value_pln), 0);
                const ikzeTotal = ikze.reduce((s, p) => s + parseFloat(p.market_value_pln), 0);
                const ikePnl = ike.reduce((s, p) => s + parseFloat(p.pnl_pln), 0);
                const ikzePnl = ikze.reduce((s, p) => s + parseFloat(p.pnl_pln), 0);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {ike.length > 0 && (<>
                      <div className="bg-slate-800/50 rounded-lg p-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">IKE — wartosc</div>
                        <div className="text-sm font-semibold text-white">{formatPLN(ikeTotal)}</div>
                        <div className="text-[10px] text-slate-500">{ike.length} pozycji</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-lg p-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">IKE — zysk/strata</div>
                        <div className={`text-sm font-semibold ${profitColor(ikePnl)}`}>{formatPLN(ikePnl)}</div>
                      </div>
                    </>)}
                    {ikze.length > 0 && (<>
                      <div className="bg-slate-800/50 rounded-lg p-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">IKZE — wartosc</div>
                        <div className="text-sm font-semibold text-white">{formatPLN(ikzeTotal)}</div>
                        <div className="text-[10px] text-slate-500">{ikze.length} pozycji</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-lg p-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">IKZE — zysk/strata</div>
                        <div className={`text-sm font-semibold ${profitColor(ikzePnl)}`}>{formatPLN(ikzePnl)}</div>
                      </div>
                    </>)}
                  </div>
                );
              })()}

              {/* Positions table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-400 font-medium">Konto</th>
                      <th className="text-left py-2 px-2 text-slate-400 font-medium">Symbol</th>
                      <th className="text-left py-2 px-2 text-slate-400 font-medium">Gielda</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Ilosc</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Sr. cena kupna</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Cena obecna</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Zmiana</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Zysk/Strata PLN</th>
                      <th className="text-right py-2 px-2 text-slate-400 font-medium">Wartosc PLN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ikeResult.report.positions.map((p, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="py-1.5 px-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            p.account_type === "IKE" ? "bg-blue-500/15 text-blue-400" : "bg-purple-500/15 text-purple-400"
                          }`}>
                            {p.account_type}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-slate-200 font-medium">{p.symbol}</td>
                        <td className="py-1.5 px-2 text-slate-400">{p.exchange}</td>
                        <td className="py-1.5 px-2 text-right text-slate-200">{formatNumber(p.quantity, 0)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">{formatNumber(p.avg_buy_price, 2)} {p.currency}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">{formatNumber(p.current_price, 2)} {p.currency}</td>
                        <td className={`py-1.5 px-2 text-right ${profitColor(p.change_pct)}`}>{formatNumber(p.change_pct, 2)}%</td>
                        <td className={`py-1.5 px-2 text-right font-medium ${profitColor(p.pnl_pln)}`}>{formatPLN(p.pnl_pln)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-200">{formatPLN(p.market_value_pln)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-700">
                      <td colSpan={7} className="py-2 px-2 text-right text-slate-400 font-medium">Razem:</td>
                      <td className={`py-2 px-2 text-right font-bold ${profitColor(
                        ikeResult.report.positions.reduce((s, p) => s + parseFloat(p.pnl_pln), 0)
                      )}`}>
                        {formatPLN(ikeResult.report.positions.reduce((s, p) => s + parseFloat(p.pnl_pln), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-white">
                        {formatPLN(ikeResult.report.positions.reduce((s, p) => s + parseFloat(p.market_value_pln), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {ikeResult.report.warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-300">
                  <p className="font-semibold mb-1">Ostrzezenia:</p>
                  {ikeResult.report.warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---- Manual buy entries ---- */}
        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Uzupelnij brakujace kupna (opcjonalnie)
            </h2>
            <p className="text-xs text-slate-400">
              Jesli nie masz pliku CSV z kupnem danego waloru (np. kupno z 2022 r.),
              wpisz dane recznie. Te pozycje zostana dolaczone do historii FIFO.
            </p>
          </div>

          {manualBuys.map((buy, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_1fr_1fr_auto_1fr_auto] gap-2 items-end"
            >
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Symbol</label>
                )}
                <input
                  type="text"
                  placeholder="np. AAPL"
                  value={buy.symbol}
                  onChange={(e) => updateManualBuy(i, "symbol", e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Data kupna</label>
                )}
                <input
                  type="date"
                  value={buy.tradeDate}
                  onChange={(e) => updateManualBuy(i, "tradeDate", e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Ilosc</label>
                )}
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="10"
                  value={buy.quantity}
                  onChange={(e) => updateManualBuy(i, "quantity", e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Cena jedn.</label>
                )}
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="150.00"
                  value={buy.price}
                  onChange={(e) => updateManualBuy(i, "price", e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Waluta</label>
                )}
                <select
                  value={buy.currency}
                  onChange={(e) => updateManualBuy(i, "currency", e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-2 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                  <option value="PLN">PLN</option>
                </select>
              </div>
              <div>
                {i === 0 && (
                  <label className="block text-xs text-slate-400 mb-1">Prowizja</label>
                )}
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={buy.commission}
                  onChange={(e) => updateManualBuy(i, "commission", e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
              <button
                onClick={() => removeManualBuy(i)}
                className="text-slate-500 hover:text-red-400 transition-colors p-2"
                aria-label="Usun pozycje"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          <button
            onClick={addManualBuy}
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Dodaj pozycje
          </button>
        </section>

        {/* ---- Parameters section ---- */}
        <section className="card space-y-6">
          <h2 className="text-lg font-semibold text-white">
            2. Parametry obliczen
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Tax year */}
            <div>
              <label
                htmlFor="taxYear"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Rok podatkowy (za ktory rozliczasz PIT-38)
              </label>
              <select
                id="taxYear"
                value={taxYear}
                onChange={(e) => setTaxYear(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-4 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                           transition-colors"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1.5">
                Sprzedaze i dywidendy z tego roku beda rozliczone. Kupna z wczesniejszych lat posluza do FIFO.
              </p>
            </div>

            {/* Prior year loss */}
            <div>
              <label
                htmlFor="priorLoss"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Strata z lat ubieglych (opcjonalnie)
              </label>
              <div className="relative">
                <input
                  id="priorLoss"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={priorYearLoss}
                  onChange={(e) => setPriorYearLoss(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-slate-200 pl-4 pr-14 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                             transition-colors placeholder:text-slate-600"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  PLN
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Kwota straty do odliczenia z ostatnich 5 lat
              </p>
            </div>
          </div>
        </section>

        {/* ---- Calculate buttons ---- */}
        <div className="flex justify-center gap-4 flex-wrap">
          <button
            onClick={handleCalculate}
            disabled={loading || files.length === 0}
            className={`
              btn-glow relative px-10 py-3.5 rounded-xl font-semibold text-sm tracking-wide
              transition-all duration-200
              ${
                loading || files.length === 0
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40"
              }
            `}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="spinner w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Obliczanie...
              </span>
            ) : (
              "Oblicz podatek"
            )}
          </button>

          <button
            onClick={handlePortfolioAnalysis}
            disabled={paLoading || files.length === 0}
            className={`
              btn-glow relative px-10 py-3.5 rounded-xl font-semibold text-sm tracking-wide
              transition-all duration-200
              ${
                paLoading || files.length === 0
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
              }
            `}
          >
            {paLoading ? (
              <span className="flex items-center gap-2">
                <svg className="spinner w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Analizowanie...
              </span>
            ) : (
              "Oblicz zyski gieldowe"
            )}
          </button>
        </div>

        {/* ---- Error ---- */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-sm text-red-300">
            <div className="flex gap-3 items-start">
              <svg
                className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* ================================================================
            RESULTS
            ================================================================ */}
        {result && (
          <div ref={resultsRef} className="space-y-6 pt-4">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
              <h2 className="text-lg font-semibold text-white">
                Wyniki obliczen za {result.report.tax_year}
              </h2>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
            </div>

            {/* ---- Methodology overview ---- */}
            <InfoBox
              title="Jak dziala kalkulator?"
              isOpen={showMethodologyInfo}
              onToggle={() => setShowMethodologyInfo((v) => !v)}
            >
              <ol className="list-decimal list-inside space-y-2 text-slate-300">
                <li>
                  <span className="font-medium text-slate-200">Parsowanie plikow</span> — system automatycznie rozpoznaje brokera
                  (Interactive Brokers / Exante) i wyciaga transakcje: kupna, sprzedaze, dywidendy i podatki u zrodla (WHT).
                </li>
                <li>
                  <span className="font-medium text-slate-200">Kursy NBP</span> — kazda transakcja w walucie obcej jest przeliczana
                  na PLN wedlug sredniego kursu NBP (tabela A) z dnia roboczego <em>poprzedzajacego</em> date rozliczenia
                  (settlement date), zgodnie z art. 11a ust. 1 ustawy o PIT.
                </li>
                <li>
                  <span className="font-medium text-slate-200">Data rozliczenia</span> — dla gield US/CA/MX po 28.05.2024
                  stosuje sie T+1 (transakcja + 1 dzien roboczy), dla pozostalych T+2.
                </li>
                <li>
                  <span className="font-medium text-slate-200">Metoda FIFO</span> — sprzedaze sa parowane z najstarszymi
                  kupnami tego samego waloru (First In, First Out), zgodnie z art. 30a ust. 3 ustawy o PIT.
                </li>
                <li>
                  <span className="font-medium text-slate-200">Podatek 19%</span> — stawka zryczaltowana od zyskow kapitalowych
                  (art. 30b ustawy o PIT). Kwota koncowa zaokraglona do pelnych zlotych.
                </li>
              </ol>
            </InfoBox>

            {/* ---- File summaries ---- */}
            <section className="card space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Podsumowanie plikow
              </h3>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th>Plik</th>
                      <th>Broker</th>
                      <th>Transakcje</th>
                      <th>Kupno</th>
                      <th>Sprzedaz</th>
                      <th>Dywidendy</th>
                      <th>WHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.files.map((f, i) => (
                      <tr key={i}>
                        <td className="font-medium text-slate-200">
                          {f.filename}
                          {f.note && (
                            <div className="text-[10px] text-indigo-300 mt-0.5">{f.note}</div>
                          )}
                        </td>
                        <td>
                          <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            f.note ? "bg-indigo-500/15 text-indigo-400" : "bg-blue-500/15 text-blue-400"
                          }`}>
                            {f.broker}
                          </span>
                        </td>
                        <td>{f.transactions_count}</td>
                        <td>{f.buys}</td>
                        <td>{f.sells}</td>
                        <td>{f.dividends}</td>
                        <td>{f.wht}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ---- PIT-38 Summary ---- */}
            <section className="card space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                  />
                </svg>
                PIT-38 -- Zyski kapitalowe
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SummaryCard
                  label="Przychod (poz. 22)"
                  value={formatPLN(result.report.capital_gains.revenue_pln)}
                  color="text-slate-200"
                />
                <SummaryCard
                  label="Koszty (poz. 23)"
                  value={formatPLN(result.report.capital_gains.costs_pln)}
                  color="text-slate-200"
                />
                <SummaryCard
                  label="Dochod / Strata"
                  value={formatPLN(result.report.capital_gains.profit_pln)}
                  color={profitColor(
                    result.report.capital_gains.profit_pln
                  )}
                />
                <SummaryCard
                  label="Podatek nalezny (19%)"
                  value={formatPLN(result.report.capital_gains.tax_due)}
                  color="text-amber-400"
                  highlight
                />
              </div>

              <InfoBox
                title="Jak obliczono zyski kapitalowe?"
                isOpen={showCapGainsInfo}
                onToggle={() => setShowCapGainsInfo((v) => !v)}
              >
                <div className="space-y-3 text-slate-300">
                  <p>
                    <span className="font-medium text-slate-200">Przychod (poz. 22 PIT-38)</span> — suma przychodow
                    ze sprzedazy papierow wartosciowych w {result.report.tax_year} r., przeliczona na PLN wg kursow NBP.
                    Wzor: <code className="text-blue-300 bg-slate-800 px-1.5 py-0.5 rounded text-xs">cena sprzedazy x ilosc x kurs NBP</code>
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">Koszty (poz. 23 PIT-38)</span> — suma kosztow nabycia
                    (cena kupna x ilosc x kurs NBP z dnia kupna) + prowizje brokerskie, parowane metoda FIFO.
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">Dochod / Strata</span> — roznica: Przychod - Koszty.
                    Jesli ujemna, to strate mozesz odliczyc w nastepnych 5 latach (max 50% straty rocznie).
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">Podatek 19%</span> — stawka zryczaltowana od dochodu,
                    zaokraglona do pelnych zlotych (zgodnie z Ordynacja Podatkowa). Jesli dochod &le; 0, podatek wynosi 0 zl.
                  </p>
                  <div className="mt-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                    <p className="text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Przyklad:</span> Kupiles 10 akcji AAPL po 150 USD (kurs NBP 4,20 PLN)
                      = koszt 6 300 PLN. Sprzedales po 180 USD (kurs NBP 4,10 PLN) = przychod 7 380 PLN.
                      Zysk: 7 380 - 6 300 = 1 080 PLN. Podatek: 1 080 x 19% = 205 PLN.
                    </p>
                  </div>
                </div>
              </InfoBox>
            </section>

            {/* ---- Dividends Summary ---- */}
            <section className="card space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-purple-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Dywidendy
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SummaryCard
                  label="Dywidendy brutto"
                  value={formatPLN(result.report.dividends.total_gross_pln)}
                  color="text-slate-200"
                />
                <SummaryCard
                  label="WHT zaplacony"
                  value={formatPLN(result.report.dividends.total_wht_pln)}
                  color="text-slate-200"
                />
                <SummaryCard
                  label="Podatek PL (19%)"
                  value={formatPLN(
                    result.report.dividends.total_polish_tax_due
                  )}
                  color="text-slate-200"
                />
                <SummaryCard
                  label="Do zaplaty w PL"
                  value={formatPLN(
                    result.report.dividends.total_to_pay_pln
                  )}
                  color="text-amber-400"
                  highlight
                />
              </div>

              {/* Dividend detail toggle */}
              {result.report.dividends.items.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowDividendDetail((v) => !v)}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${showDividendDetail ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    {showDividendDetail
                      ? "Ukryj szczegoly"
                      : `Pokaz szczegoly (${result.report.dividends.items.length} pozycji)`}
                  </button>

                  {showDividendDetail && (
                    <div className="overflow-x-auto mt-4">
                      <table className="data-table w-full">
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Broker</th>
                            <th>Kraj</th>
                            <th>Data</th>
                            <th>Waluta</th>
                            <th>Brutto</th>
                            <th>Brutto PLN</th>
                            <th>WHT</th>
                            <th>WHT PLN</th>
                            <th>Do zaplaty PL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.report.dividends.items.map((d, i) => (
                            <tr key={i}>
                              <td className="font-medium text-slate-200">
                                {d.symbol}
                              </td>
                              <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.broker?.startsWith("EXANTE") ? "bg-violet-900/60 text-violet-300" : "bg-emerald-900/60 text-emerald-300"}`}>{d.broker || "?"}</span></td>
                              <td>{d.country || "-"}</td>
                              <td>{formatDate(d.pay_date)}</td>
                              <td>{d.currency}</td>
                              <td>{formatNumber(d.gross_amount)}</td>
                              <td>{formatPLN(d.gross_amount_pln)}</td>
                              <td>{formatNumber(d.wht_amount)}</td>
                              <td>{formatPLN(d.wht_amount_pln)}</td>
                              <td className="text-amber-400 font-medium">
                                {formatPLN(d.tax_to_pay_poland)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <InfoBox
                title="Jak obliczono podatek od dywidend?"
                isOpen={showDividendInfo}
                onToggle={() => setShowDividendInfo((v) => !v)}
              >
                <div className="space-y-3 text-slate-300">
                  <p>
                    <span className="font-medium text-slate-200">Dywidendy brutto</span> — kwota dywidendy otrzymanej
                    od zagranicznego emitenta, przeliczona na PLN wg kursu NBP z dnia poprzedzajacego wyplate.
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">WHT (Withholding Tax)</span> — podatek u zrodla pobrany
                    przez zagraniczny kraj (np. 15% w USA na podstawie umowy o unikaniu podwojnego opodatkowania,
                    formularz W-8BEN).
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">Podatek PL 19%</span> — Polska wymaga 19% podatku
                    od dywidend. Jesli juz zaplaciles WHT za granica, odliczasz go od polskiego podatku.
                  </p>
                  <p>
                    <span className="font-medium text-slate-200">Do zaplaty w PL</span> — roznica:
                    <code className="text-blue-300 bg-slate-800 px-1.5 py-0.5 rounded text-xs ml-1">
                      max(0, podatek_PL_19% - WHT_w_PLN)
                    </code>.
                    Jesli WHT pokrywa caly polski podatek, do zaplaty jest 0 zl.
                  </p>
                  <div className="mt-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                    <p className="text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Przyklad:</span> Dywidenda 100 USD (kurs NBP 4,00 = 400 PLN).
                      USA pobraly 15% WHT = 15 USD = 60 PLN. Polski podatek: 400 x 19% = 76 PLN.
                      Do zaplaty w PL: 76 - 60 = 16 PLN.
                    </p>
                  </div>
                </div>
              </InfoBox>
            </section>

            {/* ---- PIT/ZG Country Breakdown ---- */}
            {result.report.pit_zg.length > 0 && (
              <section className="card space-y-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-sky-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  PIT/ZG -- Rozliczenie wg krajow
                </h3>

                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>Kod</th>
                        <th>Kraj</th>
                        <th>Zyski kapitalowe PLN</th>
                        <th>Dywidendy PLN</th>
                        <th>Podatek zaplacony za granica PLN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.report.pit_zg.map((c, i) => (
                        <tr key={i}>
                          <td className="font-mono text-slate-300">
                            {c.country_code}
                          </td>
                          <td className="text-slate-200">{c.country_name}</td>
                          <td>{formatPLN(c.capital_gains_pln)}</td>
                          <td>{formatPLN(c.dividend_income_pln)}</td>
                          <td>{formatPLN(c.tax_paid_abroad_pln)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ---- PIT-38 Form Guide ---- */}
            <section className="card space-y-4">
              <button
                onClick={() => setShowFormGuide((v) => !v)}
                className="w-full flex items-center gap-2 text-left"
              >
                <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <h3 className="text-base font-semibold text-white flex-1">
                  Instrukcja wypelniania PIT-38 i PIT/ZG
                </h3>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform ${showFormGuide ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showFormGuide && (
                <div className="space-y-6">
                  {/* PIT-38 Część C */}
                  <div>
                    <h4 className="text-sm font-semibold text-orange-400 mb-3">
                      PIT-38 -- Czesc C: Dochody/straty z odplatnego zbycia papierow wartosciowych
                    </h4>
                    <div className="space-y-2">
                      <FormFieldRow
                        field="Poz. 22"
                        label="Przychod"
                        value={formatPLN(result.report.capital_gains.revenue_pln)}
                        description="Suma przychodow ze sprzedazy papierow wartosciowych w PLN"
                      />
                      <FormFieldRow
                        field="Poz. 23"
                        label="Koszty uzyskania przychodu"
                        value={formatPLN(result.report.capital_gains.costs_pln)}
                        description="Suma kosztow nabycia (cena kupna + prowizje) w PLN"
                      />
                      {parseFloat(result.report.capital_gains.profit_pln) >= 0 ? (
                        <FormFieldRow
                          field="Poz. 26"
                          label="Dochod"
                          value={formatPLN(result.report.capital_gains.profit_pln)}
                          description="Przychod minus koszty (poz. 22 - poz. 23). Wpisz gdy wynik jest dodatni."
                          highlight
                        />
                      ) : (
                        <FormFieldRow
                          field="Poz. 27"
                          label="Strata"
                          value={formatPLN(Math.abs(parseFloat(result.report.capital_gains.profit_pln)))}
                          description="Koszty minus przychod (poz. 23 - poz. 22). Wpisz gdy wynik jest ujemny. Strate mozesz odliczyc w nastepnych 5 latach."
                          highlight
                        />
                      )}
                    </div>
                  </div>

                  {/* PIT-38 Część E */}
                  <div>
                    <h4 className="text-sm font-semibold text-orange-400 mb-3">
                      PIT-38 -- Czesc E: Obliczenie podatku
                    </h4>
                    <div className="space-y-2">
                      <FormFieldRow
                        field="Poz. 30"
                        label="Podstawa obliczenia podatku"
                        value={formatPLN(
                          Math.max(0, parseFloat(result.report.capital_gains.profit_pln))
                        )}
                        description="Dochod po odliczeniu strat z lat ubieglych, zaokraglony do pelnych zlotych"
                      />
                      <FormFieldRow
                        field="Poz. 31"
                        label="Podatek (19%)"
                        value={formatPLN(result.report.capital_gains.tax_due)}
                        description="19% od podstawy z poz. 30, zaokraglone do pelnych zlotych"
                        highlight
                      />
                    </div>
                  </div>

                  {/* Dywidendy */}
                  {parseFloat(result.report.dividends.total_gross_pln) > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-orange-400 mb-3">
                        PIT-38 -- Czesc G / PIT-36: Dywidendy zagraniczne
                      </h4>
                      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 mb-3">
                        <p className="text-xs text-blue-300">
                          Dywidendy z zagranicy rozliczasz w <span className="font-semibold">PIT-36</span> (Czesc G -- Dochody z zagranicy)
                          lub w <span className="font-semibold">PIT-38 Czesc G</span>, w zaleznosci od zrodla.
                          W przypadku dywidend z akcji notowanych na gieldach zagranicznych najczesciej
                          stosuje sie PIT-36 z zalacznikiem PIT/ZG.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <FormFieldRow
                          field="Dochod"
                          label="Dywidendy brutto w PLN"
                          value={formatPLN(result.report.dividends.total_gross_pln)}
                          description="Suma dywidend brutto przeliczona na PLN wg kursow NBP"
                        />
                        <FormFieldRow
                          field="Podatek zaplacony za granica"
                          label="WHT (Withholding Tax)"
                          value={formatPLN(result.report.dividends.total_wht_pln)}
                          description="Podatek u zrodla pobrany za granica, do odliczenia od polskiego podatku"
                        />
                        <FormFieldRow
                          field="Podatek nalezny PL"
                          label="19% od dywidend brutto"
                          value={formatPLN(result.report.dividends.total_polish_tax_due)}
                          description="Polski podatek: 19% x dywidendy brutto PLN"
                        />
                        <FormFieldRow
                          field="Do zaplaty"
                          label="Roznica do wplaty"
                          value={formatPLN(result.report.dividends.total_to_pay_pln)}
                          description="max(0, podatek PL - WHT). Jesli WHT pokrywa caly podatek, wpisujesz 0."
                          highlight
                        />
                      </div>
                    </div>
                  )}

                  {/* PIT/ZG */}
                  {result.report.pit_zg.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-orange-400 mb-3">
                        Zalacznik PIT/ZG -- Informacja o dochodach z zagranicy
                      </h4>
                      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 mb-3">
                        <p className="text-xs text-blue-300">
                          Dla kazdego kraju, z ktorego uzyskales dochod, wypelniasz <span className="font-semibold">osobny PIT/ZG</span>.
                          Ponizej dane do wpisania w odpowiednie rubryki.
                        </p>
                      </div>
                      {result.report.pit_zg.map((c, i) => (
                        <div key={i} className="mb-4 last:mb-0">
                          <p className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-2">
                            <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">
                              {c.country_code}
                            </span>
                            {c.country_name}
                          </p>
                          <div className="space-y-2 pl-4 border-l-2 border-slate-700">
                            {parseFloat(c.capital_gains_pln) !== 0 && (
                              <FormFieldRow
                                field="Czesc C.1"
                                label="Dochod z odplatnego zbycia papierow"
                                value={formatPLN(c.capital_gains_pln)}
                                description="Zyski kapitalowe ze sprzedazy akcji/ETF w danym kraju"
                              />
                            )}
                            {parseFloat(c.dividend_income_pln) !== 0 && (
                              <FormFieldRow
                                field="Czesc C.2"
                                label="Dochod z dywidend"
                                value={formatPLN(c.dividend_income_pln)}
                                description="Dywidendy brutto w PLN z emitentow zarejestrowanych w danym kraju"
                              />
                            )}
                            {parseFloat(c.tax_paid_abroad_pln) !== 0 && (
                              <FormFieldRow
                                field="Czesc C.2"
                                label="Podatek zaplacony za granica"
                                value={formatPLN(c.tax_paid_abroad_pln)}
                                description="WHT pobrany u zrodla (do odliczenia od podatku polskiego)"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Uwagi koncowe */}
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                    <p className="text-xs text-amber-300 space-y-1.5">
                      <span className="font-semibold block">Wazne uwagi:</span>
                      <span className="block">1. Numery pozycji moga sie roznic w zaleznosci od wersji formularza PIT-38 (sprawdz aktualny formularz na e-Deklaracje).</span>
                      <span className="block">2. Jesli masz strate z lat ubieglych, wpisz ja w Czesci D (poz. 28-29). Mozesz odliczyc max 50% straty rocznie, przez 5 lat.</span>
                      <span className="block">3. Termin zlozenia PIT-38: do 30 kwietnia roku nastepnego po roku podatkowym.</span>
                      <span className="block">4. Wyniki sa pomocnicze — zweryfikuj z doradca podatkowym przed zlozeniem deklaracji.</span>
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* ---- Analytics Section ---- */}
            {analytics && analytics.totalTrades > 0 && (
              <section className="card space-y-4">
                <button
                  onClick={() => setShowAnalytics((v) => !v)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">
                    Analiza portfela
                  </h3>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${showAnalytics ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAnalytics && (
                  <div className="space-y-6">
                    {/* -- General Stats -- */}
                    <div>
                      <h4 className="text-sm font-medium text-slate-300 mb-3">Statystyki ogolne</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Transakcji</p>
                          <p className="text-lg font-semibold text-slate-200">{analytics.totalTrades}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Zyskownych</p>
                          <p className="text-lg font-semibold text-emerald-400">{analytics.profitableTrades}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Stratnych</p>
                          <p className="text-lg font-semibold text-red-400">{analytics.lossTrades}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Sredni zysk/strata</p>
                          <p className={`text-lg font-semibold ${profitColor(analytics.avgProfit)}`}>{formatPLN(analytics.avgProfit)}</p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Unikalnych walorow</p>
                          <p className="text-lg font-semibold text-slate-200">{analytics.uniqueSymbols}</p>
                        </div>
                      </div>
                    </div>

                    {/* -- Charts Overview Row -- */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                      <div className="lg:col-span-3 bg-slate-800/40 rounded-xl p-4">
                        <h4 className="text-sm font-medium text-slate-300 mb-3">Zysk/strata miesiecznie</h4>
                        <MonthlyPnlChart data={analytics.monthlyPnlList} />
                      </div>
                      <div className="lg:col-span-2 bg-slate-800/40 rounded-xl p-4 flex flex-col items-center">
                        <h4 className="text-sm font-medium text-slate-300 mb-3">Skutecznosc transakcji</h4>
                        <WinLossDonut
                          wins={analytics.profitableTrades}
                          losses={analytics.lossTrades}
                          breakeven={analytics.totalTrades - analytics.profitableTrades - analytics.lossTrades}
                        />
                      </div>
                    </div>

                    {/* -- P&L per Symbol -- */}
                    <div>
                      <h4 className="text-sm font-medium text-slate-300 mb-3">Zysk/strata per walor</h4>
                      <div className="overflow-x-auto">
                        <table className="data-table w-full text-xs">
                          <thead>
                            <tr>
                              <th>Symbol</th>
                              <th>Broker</th>
                              <th>Transakcji</th>
                              <th>Przychod PLN</th>
                              <th>Koszt PLN</th>
                              <th>Zysk/Strata PLN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analytics.symbolPnlList.map((s, i) => (
                              <tr key={`${s.symbol}-${s.broker}-${i}`}>
                                <td className="font-medium text-slate-200">{s.symbol}</td>
                                <td><span className={`text-[10px] px-1.5 py-0.5 rounded ${s.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{s.broker}</span></td>
                                <td>{s.trades}</td>
                                <td>{formatPLN(s.revenue)}</td>
                                <td>{formatPLN(s.cost)}</td>
                                <td className={`font-medium ${profitColor(s.profit)}`}>{formatPLN(s.profit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {analytics.symbolPnlList.length > 1 && (
                        <div className="bg-slate-800/40 rounded-xl p-4 mt-2">
                          <h4 className="text-sm font-medium text-slate-300 mb-2">Top 10 walorow (zysk/strata)</h4>
                          <SymbolPnlChart data={analytics.symbolPnlList} />
                        </div>
                      )}
                    </div>

                    {/* -- Best & Worst Trades -- */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-sm font-medium text-emerald-400 mb-3">Top 5 najlepszych transakcji</h4>
                        <div className="space-y-2">
                          {analytics.bestTrades.map((m, i) => (
                            <div key={i} className="flex justify-between items-center bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200">{m.symbol}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ${m.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{m.broker || "?"}</span>
                                <span className="text-xs text-slate-500">{formatDate(m.sell_date)}</span>
                              </div>
                              <span className="text-sm font-semibold text-emerald-400">{formatPLN(m.profit_pln)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-red-400 mb-3">Top 5 najgorszych transakcji</h4>
                        <div className="space-y-2">
                          {analytics.worstTrades.map((m, i) => (
                            <div key={i} className="flex justify-between items-center bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200">{m.symbol}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ${m.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{m.broker || "?"}</span>
                                <span className="text-xs text-slate-500">{formatDate(m.sell_date)}</span>
                              </div>
                              <span className="text-sm font-semibold text-red-400">{formatPLN(m.profit_pln)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* -- Commissions -- */}
                    <div>
                      <h4 className="text-sm font-medium text-slate-300 mb-3">Prowizje brokerskie</h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Prowizje kupna</p>
                          <p className="text-lg font-semibold text-slate-200">
                            {formatNumber(analytics.totalBuyCommission)} <span className="text-xs text-slate-500">(waluta oryg.)</span>
                          </p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Prowizje sprzedazy</p>
                          <p className="text-lg font-semibold text-slate-200">
                            {formatNumber(analytics.totalSellCommission)} <span className="text-xs text-slate-500">(waluta oryg.)</span>
                          </p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-xs text-slate-400">Lacznie</p>
                          <p className="text-lg font-semibold text-amber-400">
                            {formatNumber(analytics.totalBuyCommission + analytics.totalSellCommission)} <span className="text-xs text-slate-500">(waluta oryg.)</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* -- Dividends per symbol -- */}
                    {analytics.divBySymbolList.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-slate-300 mb-3">Dywidendy per walor</h4>
                        <div className="overflow-x-auto">
                          <table className="data-table w-full text-xs">
                            <thead>
                              <tr>
                                <th>Symbol</th>
                                <th>Broker</th>
                                <th>Wyplat</th>
                                <th>Brutto PLN</th>
                                <th>WHT PLN</th>
                                <th>Do zaplaty PL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analytics.divBySymbolList.map((d) => (
                                <tr key={`${d.symbol}|${d.broker}`}>
                                  <td className="font-medium text-slate-200">{d.symbol}</td>
                                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.broker?.startsWith("EXANTE") ? "bg-violet-900/60 text-violet-300" : "bg-emerald-900/60 text-emerald-300"}`}>{d.broker}</span></td>
                                  <td>{d.count}</td>
                                  <td>{formatPLN(d.gross)}</td>
                                  <td>{formatPLN(d.wht)}</td>
                                  <td className="text-amber-400 font-medium">{formatPLN(d.toPay)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {analytics.divBySymbolList.length > 1 && (
                          <div className="bg-slate-800/40 rounded-xl p-4 mt-3">
                            <h4 className="text-sm font-medium text-slate-300 mb-2">Dywidendy — wykres</h4>
                            <DividendChart data={analytics.divBySymbolList} />
                          </div>
                        )}
                      </div>
                    )}

                    {/* -- Currency Breakdown -- */}
                    {Object.keys(analytics.currencyStats).length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-slate-300 mb-3">Obroty wg walut</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {Object.entries(analytics.currencyStats).map(([cur, stats]) => (
                            <div key={cur} className="bg-slate-800/60 rounded-lg p-3">
                              <p className="text-xs text-slate-400">{cur}</p>
                              <p className="text-lg font-semibold text-slate-200">{stats.buys + stats.sells} <span className="text-xs text-slate-500">transakcji</span></p>
                              <p className="text-xs text-slate-400 mt-1">Obrot: {formatPLN(stats.volume)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* ---- Lifetime Portfolio Report ---- */}
            {result.report.portfolio && (
              <section className="card space-y-4">
                <button
                  onClick={() => setShowPortfolioReport((v) => !v)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">
                    Raport portfela — cala historia inwestycji
                  </h3>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${showPortfolioReport ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showPortfolioReport && (
                  <div className="space-y-6">
                    {/* --- Overall Metrics Grid --- */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      <SummaryCard
                        label="Zainwestowano (kupna)"
                        value={formatPLN(result.report.portfolio.metrics.total_invested_pln)}
                      />
                      <SummaryCard
                        label="Przychod ze sprzedazy"
                        value={formatPLN(result.report.portfolio.metrics.total_revenue_pln)}
                      />
                      <SummaryCard
                        label="Zrealizowany zysk/strata"
                        value={formatPLN(result.report.portfolio.metrics.total_realized_profit_pln)}
                        highlight={parseFloat(result.report.portfolio.metrics.total_realized_profit_pln) > 0}
                      />
                      <SummaryCard
                        label="Prowizje lacznie"
                        value={formatPLN(result.report.portfolio.metrics.total_commissions_pln)}
                      />
                      <SummaryCard
                        label="Dywidendy brutto"
                        value={formatPLN(result.report.portfolio.metrics.total_dividends_gross_pln)}
                      />
                      <SummaryCard
                        label="WHT zaplacony"
                        value={formatPLN(result.report.portfolio.metrics.total_wht_paid_pln)}
                      />
                      <SummaryCard
                        label="Transakcje"
                        value={`${result.report.portfolio.metrics.total_trades} (${result.report.portfolio.metrics.winning_trades}W / ${result.report.portfolio.metrics.losing_trades}L)`}
                      />
                      <SummaryCard
                        label="Win rate"
                        value={`${formatNumber(result.report.portfolio.metrics.win_rate_percent, 1)}%`}
                      />
                      <SummaryCard
                        label="Sr. zysk na transakcje"
                        value={formatPLN(result.report.portfolio.metrics.avg_profit_per_trade_pln)}
                      />
                      <SummaryCard
                        label="Sr. czas trzymania"
                        value={`${formatNumber(result.report.portfolio.metrics.avg_holding_period_days, 0)} dni`}
                      />
                      <SummaryCard
                        label="Wiek konta"
                        value={`${result.report.portfolio.metrics.account_age_days} dni`}
                      />
                      <SummaryCard
                        label="Unikalne walory"
                        value={`${result.report.portfolio.metrics.unique_symbols_traded}`}
                      />
                    </div>

                    {result.report.portfolio.metrics.first_trade_date && (
                      <p className="text-[11px] text-slate-500">
                        Okres: {formatDate(result.report.portfolio.metrics.first_trade_date)} — {formatDate(result.report.portfolio.metrics.last_trade_date)}
                      </p>
                    )}

                    {/* --- Year-by-Year Summary --- */}
                    {result.report.portfolio.year_summaries.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-indigo-300 mb-3">Podsumowanie rok po roku</h4>
                        <div className="overflow-x-auto">
                          <table className="data-table w-full text-xs">
                            <thead>
                              <tr>
                                <th>Rok</th>
                                <th>Przychod PLN</th>
                                <th>Koszty PLN</th>
                                <th>Zysk/Strata PLN</th>
                                <th>Podatek 19%</th>
                                <th>Dyw. brutto PLN</th>
                                <th>WHT PLN</th>
                                <th>Dyw. do zaplaty</th>
                                <th>Trans.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.report.portfolio.year_summaries.map((ys) => (
                                <tr key={ys.year}>
                                  <td className="font-semibold text-slate-200">{ys.year}</td>
                                  <td>{formatPLN(ys.revenue_pln)}</td>
                                  <td>{formatPLN(ys.costs_pln)}</td>
                                  <td className={profitColor(ys.profit_pln)}>{formatPLN(ys.profit_pln)}</td>
                                  <td>{formatPLN(ys.tax_19_pln)}</td>
                                  <td>{formatPLN(ys.dividends_gross_pln)}</td>
                                  <td>{formatPLN(ys.dividends_wht_pln)}</td>
                                  <td>{formatPLN(ys.dividends_tax_to_pay_pln)}</td>
                                  <td className="text-center">{ys.num_trades}</td>
                                </tr>
                              ))}
                              {/* Totals row — sum per-year values (closed positions only) */}
                              {result.report.portfolio.year_summaries.length > 1 && (() => {
                                const ys = result.report.portfolio.year_summaries;
                                const sumRevenue = ys.reduce((a, y) => a + parseFloat(y.revenue_pln), 0);
                                const sumCosts = ys.reduce((a, y) => a + parseFloat(y.costs_pln), 0);
                                const sumProfit = ys.reduce((a, y) => a + parseFloat(y.profit_pln), 0);
                                const sumDivGross = ys.reduce((a, y) => a + parseFloat(y.dividends_gross_pln), 0);
                                const sumDivWht = ys.reduce((a, y) => a + parseFloat(y.dividends_wht_pln), 0);
                                const sumTrades = ys.reduce((a, y) => a + y.num_trades, 0);
                                return (
                                  <tr className="border-t border-slate-600 font-semibold">
                                    <td className="text-slate-200">Razem</td>
                                    <td>{formatPLN(sumRevenue.toFixed(2))}</td>
                                    <td>{formatPLN(sumCosts.toFixed(2))}</td>
                                    <td className={profitColor(sumProfit.toFixed(2))}>
                                      {formatPLN(sumProfit.toFixed(2))}
                                    </td>
                                    <td>—</td>
                                    <td>{formatPLN(sumDivGross.toFixed(2))}</td>
                                    <td>{formatPLN(sumDivWht.toFixed(2))}</td>
                                    <td>—</td>
                                    <td className="text-center">{sumTrades}</td>
                                  </tr>
                                );
                              })()}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* --- Per-Symbol Lifetime --- */}
                    {result.report.portfolio.symbol_summaries.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-indigo-300 mb-3">Podsumowanie per walor (cala historia)</h4>
                        <div className="overflow-x-auto">
                          <table className="data-table w-full text-xs">
                            <thead>
                              <tr>
                                <th>Symbol</th>
                                <th>Kupiono</th>
                                <th>Sprzedano</th>
                                <th>Pozostalo</th>
                                <th>Sr. cena</th>
                                <th>Waluta</th>
                                <th>Koszt kupna PLN</th>
                                <th>Przychod PLN</th>
                                <th>Zreal. Z/S PLN</th>
                                <th>Dywidendy PLN</th>
                                <th>Pierwszy</th>
                                <th>Ostatni</th>
                                <th>Trans.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.report.portfolio.symbol_summaries.map((ss) => (
                                <tr key={ss.symbol}>
                                  <td className="font-semibold text-slate-200">{ss.symbol}</td>
                                  <td>{formatNumber(ss.total_bought_qty, 4)}</td>
                                  <td>{formatNumber(ss.total_sold_qty, 4)}</td>
                                  <td className={parseFloat(ss.remaining_qty) > 0 ? "text-cyan-400 font-medium" : ""}>
                                    {formatNumber(ss.remaining_qty, 4)}
                                  </td>
                                  <td>{formatNumber(ss.avg_buy_price, 2)}</td>
                                  <td>{ss.currency}</td>
                                  <td>{formatPLN(ss.total_buy_cost_pln)}</td>
                                  <td>{formatPLN(ss.total_sell_revenue_pln)}</td>
                                  <td className={profitColor(ss.realized_pnl_pln)}>{formatPLN(ss.realized_pnl_pln)}</td>
                                  <td>{parseFloat(ss.dividends_pln) > 0 ? formatPLN(ss.dividends_pln) : "—"}</td>
                                  <td>{formatDate(ss.first_trade_date)}</td>
                                  <td>{formatDate(ss.last_trade_date)}</td>
                                  <td className="text-center">{ss.trades_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* ---- Open Positions ---- */}
            {result.report.open_positions && result.report.open_positions.length > 0 && (
              <section className="card space-y-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Otwarte pozycje (niesprzedane)
                </h3>
                <p className="text-xs text-slate-400">
                  Walory kupione, ktore nie zostaly jeszcze sprzedane. Zostana uwzglednione w FIFO przy przyszlych sprzedazach.
                </p>
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-xs">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Broker</th>
                        <th>Ilosc</th>
                        <th>Data kupna</th>
                        <th>Cena kupna</th>
                        <th>Waluta</th>
                        <th>Kurs NBP</th>
                        <th>Koszt PLN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.report.open_positions.map((p, i) => (
                        <tr key={i}>
                          <td className="font-medium text-slate-200">{p.symbol}</td>
                          <td><span className={`text-xs px-1.5 py-0.5 rounded ${p.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{p.broker || "?"}</span></td>
                          <td>{formatNumber(p.quantity, 4)}</td>
                          <td>{formatDate(p.buy_date)}</td>
                          <td>{formatNumber(p.buy_price, 4)}</td>
                          <td>{p.currency}</td>
                          <td>{formatNumber(p.nbp_rate, 4)}</td>
                          <td>{formatPLN(p.cost_pln)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ---- Open Short Positions (written options) ---- */}
            {result.report.open_short_positions && result.report.open_short_positions.length > 0 && (
              <section className="card space-y-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  </svg>
                  Otwarte krotkie pozycje (wystawione opcje)
                </h3>
                <p className="text-xs text-slate-400">
                  Opcje/derywaty sprzedane (wystawione), ktore nie zostaly jeszcze zamkniete ani nie wygasly. Nie podlegaja opodatkowaniu do zamkniecia pozycji.
                </p>
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-xs">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Broker</th>
                        <th>Ilosc</th>
                        <th>Data sprzedazy</th>
                        <th>Cena sprzedazy</th>
                        <th>Waluta</th>
                        <th>Kurs NBP</th>
                        <th>Przychod PLN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.report.open_short_positions.map((p, i) => (
                        <tr key={i}>
                          <td className="font-medium text-slate-200">{p.symbol}</td>
                          <td><span className={`text-xs px-1.5 py-0.5 rounded ${p.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{p.broker || "?"}</span></td>
                          <td>{formatNumber(p.quantity, 4)}</td>
                          <td>{formatDate(p.sell_date)}</td>
                          <td>{formatNumber(p.sell_price, 4)}</td>
                          <td>{p.currency}</td>
                          <td>{formatNumber(p.nbp_rate, 4)}</td>
                          <td>{formatPLN(p.revenue_pln)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ---- Warnings ---- */}
            {result.report.warnings.length > 0 && (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-6 py-5 space-y-3">
                <h3 className="text-base font-semibold text-amber-400 flex items-center gap-2">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  Ostrzezenia
                </h3>
                <ul className="space-y-1.5">
                  {result.report.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="text-sm text-amber-200/80 flex items-start gap-2"
                    >
                      <span className="text-amber-500 mt-0.5">&#x2022;</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ---- FIFO Matches Detail ---- */}
            {result.report.capital_gains.matches.length > 0 && (
              <section className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <svg
                      className="w-5 h-5 text-indigo-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                    Szczegoly parowan FIFO
                  </h3>
                  <button
                    onClick={() => setShowFifoDetail((v) => !v)}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${showFifoDetail ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    {showFifoDetail
                      ? "Zwiń"
                      : `Rozwin (${result.report.capital_gains.matches.length} parowan)`}
                  </button>
                </div>

                {showFifoDetail && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Broker</th>
                          <th>Ilosc</th>
                          <th>Data kupna</th>
                          <th>Cena kupna</th>
                          <th>Waluta</th>
                          <th>Kurs NBP (K)</th>
                          <th>Koszt PLN</th>
                          <th>Data sprzedazy</th>
                          <th>Cena sprzedazy</th>
                          <th>Kurs NBP (S)</th>
                          <th>Przychod PLN</th>
                          <th>Zysk/Strata PLN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.report.capital_gains.matches.map((m, i) => (
                          <tr key={i} className={m.is_orphan ? "bg-amber-500/5" : ""}>
                            <td className="font-medium text-slate-200">
                              {m.symbol}
                              {m.is_orphan && (
                                <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                                  brak kupna
                                </span>
                              )}
                            </td>
                            <td><span className={`text-[10px] px-1.5 py-0.5 rounded ${m.broker?.startsWith("EXANTE") ? "bg-violet-900/40 text-violet-300" : "bg-emerald-900/40 text-emerald-300"}`}>{m.broker || "?"}</span></td>
                            <td>{formatNumber(m.quantity, 4)}</td>
                            <td>{m.is_orphan ? "-" : formatDate(m.buy_date)}</td>
                            <td>{m.is_orphan ? "-" : formatNumber(m.buy_price, 4)}</td>
                            <td>{m.buy_currency}</td>
                            <td>{m.is_orphan ? "-" : formatNumber(m.buy_nbp_rate, 4)}</td>
                            <td>{formatPLN(m.buy_cost_pln)}</td>
                            <td>{formatDate(m.sell_date)}</td>
                            <td>{formatNumber(m.sell_price, 4)}</td>
                            <td>{formatNumber(m.sell_nbp_rate, 4)}</td>
                            <td>{formatPLN(m.sell_revenue_pln)}</td>
                            <td
                              className={`font-medium ${profitColor(m.profit_pln)}`}
                            >
                              {formatPLN(m.profit_pln)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* ---- Portfolio Analysis Error ---- */}
        {paError && !result && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-sm text-red-300">
            <div className="flex gap-3 items-start">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{paError}</p>
            </div>
          </div>
        )}

        {/* ================================================================
            PORTFOLIO ANALYSIS RESULTS
            ================================================================ */}
        {paResult && (
          <div ref={paResultsRef} className="space-y-6">

            {/* ---- Account Overview & Key Stats ---- */}
            <section className="card space-y-4">
              <h2 className="text-lg font-bold text-indigo-400 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Analiza portfela – {paResult.report.account_name}
              </h2>
              <p className="text-xs text-slate-400">
                Okres: {paResult.report.period_start} – {paResult.report.period_end} | Waluta bazowa: {paResult.report.base_currency}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">NAV poczatkowy</div>
                  <div className="text-sm font-semibold text-white">{formatUSD(paResult.report.key_statistics.beginning_nav)}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">NAV koncowy</div>
                  <div className="text-sm font-semibold text-emerald-400">{formatUSD(paResult.report.key_statistics.ending_nav)}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Zwrot calkowity</div>
                  <div className={`text-sm font-semibold ${profitColor(paResult.report.key_statistics.cumulative_return_pct)}`}>
                    {formatPct(paResult.report.key_statistics.cumulative_return_pct)}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">MTM (zysk rynkowy)</div>
                  <div className={`text-sm font-semibold ${profitColor(paResult.report.key_statistics.mtm)}`}>
                    {formatUSD(paResult.report.key_statistics.mtm)}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Wplaty / Wyplaty</div>
                  <div className="text-sm font-semibold text-white">{formatUSD(paResult.report.key_statistics.deposits_withdrawals)}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Dywidendy</div>
                  <div className="text-sm font-semibold text-emerald-400">{formatUSD(paResult.report.key_statistics.dividends)}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Najlepszy dzien</div>
                  <div className="text-sm font-semibold text-emerald-400">{formatPct(paResult.report.key_statistics.best_return_pct)}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Najgorszy dzien</div>
                  <div className="text-sm font-semibold text-red-400">{formatPct(paResult.report.key_statistics.worst_return_pct)}</div>
                </div>
              </div>
            </section>

            {/* ---- Monthly/Yearly Returns ---- */}
            {paResult.report.monthly_returns.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaReturns(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">Zwroty miesieczne / kwartalne / roczne</h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaReturns ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaReturns && (
                  <div className="space-y-4">
                    {/* Yearly */}
                    {(() => {
                      const yearly = paResult.report.monthly_returns.filter(r => r.period_type === "year" && r.return_pct !== null);
                      if (yearly.length === 0) return null;
                      return (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase">Roczne</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {yearly.map((r, i) => (
                              <div key={i} className="bg-slate-800/50 rounded-lg p-2 text-center">
                                <div className="text-[10px] text-slate-500">{r.period}</div>
                                <div className={`text-sm font-semibold ${profitColor(r.return_pct || "0")}`}>{formatPct(r.return_pct)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Quarterly */}
                    {(() => {
                      const quarterly = paResult.report.monthly_returns.filter(r => r.period_type === "quarter" && r.return_pct !== null);
                      if (quarterly.length === 0) return null;
                      return (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase">Kwartalne</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {quarterly.map((r, i) => (
                              <div key={i} className="bg-slate-800/50 rounded-lg p-2 text-center">
                                <div className="text-[10px] text-slate-500">{r.period}</div>
                                <div className={`text-sm font-semibold ${profitColor(r.return_pct || "0")}`}>{formatPct(r.return_pct)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Monthly */}
                    {(() => {
                      const monthly = paResult.report.monthly_returns.filter(r => r.period_type === "month" && r.return_pct !== null);
                      if (monthly.length === 0) return null;
                      return (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase">Miesieczne</h4>
                          <div className="overflow-x-auto">
                            <table className="data-table w-full text-xs">
                              <thead>
                                <tr>
                                  <th className="text-left">Okres</th>
                                  <th className="text-right">Zwrot %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {monthly.map((r, i) => (
                                  <tr key={i}>
                                    <td>{r.period}</td>
                                    <td className={`text-right font-medium ${profitColor(r.return_pct || "0")}`}>{formatPct(r.return_pct)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </section>
            )}

            {/* ---- Performance by Symbol ---- */}
            {paResult.report.symbol_performance.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaSymbolPerf(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">Wyniki wg instrumentu ({paResult.report.symbol_performance.length})</h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaSymbolPerf ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaSymbolPerf && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Symbol</th>
                          <th className="text-left">Opis</th>
                          <th className="text-left">Typ</th>
                          <th className="text-right">Waga %</th>
                          <th className="text-right">Zwrot %</th>
                          <th className="text-right">Wklad %</th>
                          <th className="text-right">Niezreal. Z/S</th>
                          <th className="text-right">Zreal. Z/S</th>
                          <th className="text-center">Otwarta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paResult.report.symbol_performance.map((sp, i) => (
                          <tr key={i}>
                            <td className="font-medium text-white">{sp.symbol}</td>
                            <td className="text-slate-400 max-w-[150px] truncate">{sp.description}</td>
                            <td className="text-slate-400">{sp.financial_instrument}</td>
                            <td className="text-right">{formatNumber(sp.avg_weight_pct, 1)}</td>
                            <td className={`text-right font-medium ${profitColor(sp.return_pct)}`}>{formatPct(sp.return_pct)}</td>
                            <td className={`text-right ${profitColor(sp.contribution_pct)}`}>{formatPct(sp.contribution_pct)}</td>
                            <td className={`text-right ${profitColor(sp.unrealized_pnl)}`}>{formatUSD(sp.unrealized_pnl)}</td>
                            <td className={`text-right ${profitColor(sp.realized_pnl)}`}>{formatUSD(sp.realized_pnl)}</td>
                            <td className="text-center">{sp.is_open ? "Tak" : "Nie"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ---- Open Positions ---- */}
            {paResult.report.open_positions.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaPositions(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">Otwarte pozycje ({paResult.report.open_positions.length})</h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaPositions ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaPositions && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Symbol</th>
                          <th className="text-left">Opis</th>
                          <th className="text-left">Sektor</th>
                          <th className="text-right">Ilosc</th>
                          <th className="text-right">Cena</th>
                          <th className="text-right">Wartosc</th>
                          <th className="text-right">Koszt</th>
                          <th className="text-right">Niezreal. Z/S</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...paResult.report.open_positions]
                          .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
                          .map((pos, i) => (
                          <tr key={i}>
                            <td className="font-medium text-white">{pos.symbol}</td>
                            <td className="text-slate-400 max-w-[150px] truncate">{pos.description}</td>
                            <td className="text-slate-400">{pos.sector || "-"}</td>
                            <td className="text-right">{formatNumber(pos.quantity, 2)}</td>
                            <td className="text-right">{formatNumber(pos.close_price, 2)}</td>
                            <td className="text-right font-medium">{formatUSD(pos.value)}</td>
                            <td className="text-right">{formatUSD(pos.cost_basis)}</td>
                            <td className={`text-right font-medium ${profitColor(pos.unrealized_pnl)}`}>{formatUSD(pos.unrealized_pnl)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-700 font-semibold">
                          <td colSpan={5} className="text-right text-slate-400">Razem:</td>
                          <td className="text-right text-white">
                            {formatUSD(paResult.report.open_positions.reduce((s, p) => s + parseFloat(p.value), 0))}
                          </td>
                          <td className="text-right">
                            {formatUSD(paResult.report.open_positions.reduce((s, p) => s + parseFloat(p.cost_basis), 0))}
                          </td>
                          <td className={`text-right ${profitColor(paResult.report.open_positions.reduce((s, p) => s + parseFloat(p.unrealized_pnl), 0))}`}>
                            {formatUSD(paResult.report.open_positions.reduce((s, p) => s + parseFloat(p.unrealized_pnl), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ---- Trade Summary ---- */}
            {paResult.report.trade_summaries.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaTrades(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">Podsumowanie transakcji ({paResult.report.trade_summaries.length})</h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaTrades ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaTrades && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Symbol</th>
                          <th className="text-left">Opis</th>
                          <th className="text-left">Waluta</th>
                          <th className="text-right">Kupiono (szt.)</th>
                          <th className="text-right">Sr. cena kupna</th>
                          <th className="text-right">Koszt kupna</th>
                          <th className="text-right">Sprzedano (szt.)</th>
                          <th className="text-right">Sr. cena sprzed.</th>
                          <th className="text-right">Przychod sprzed.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paResult.report.trade_summaries.map((ts, i) => (
                          <tr key={i}>
                            <td className="font-medium text-white">{ts.symbol}</td>
                            <td className="text-slate-400 max-w-[150px] truncate">{ts.description}</td>
                            <td className="text-slate-400">{ts.currency || "-"}</td>
                            <td className="text-right">{formatNumber(ts.quantity_bought, 2)}</td>
                            <td className="text-right">{formatNumber(ts.avg_buy_price, 2)}</td>
                            <td className="text-right text-red-400">{formatNumber(ts.proceeds_bought, 2)}</td>
                            <td className="text-right">{formatNumber(Math.abs(parseFloat(ts.quantity_sold)), 2)}</td>
                            <td className="text-right">{formatNumber(ts.avg_sell_price, 2)}</td>
                            <td className="text-right text-emerald-400">{formatNumber(ts.proceeds_sold, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ---- Dividends ---- */}
            {paResult.report.dividends_list.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaDividends(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">
                    Dywidendy ({paResult.report.dividends_list.length}) – lacznie: {formatUSD(paResult.report.dividends_list.reduce((s, d) => s + parseFloat(d.amount), 0))}
                  </h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaDividends ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaDividends && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Data wyplaty</th>
                          <th className="text-left">Symbol</th>
                          <th className="text-left">Typ</th>
                          <th className="text-right">Ilosc</th>
                          <th className="text-right">Na akcje</th>
                          <th className="text-right">Kwota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paResult.report.dividends_list.map((d, i) => (
                          <tr key={i}>
                            <td>{d.pay_date}</td>
                            <td className="font-medium text-white">{d.symbol}</td>
                            <td className="text-slate-400">{d.note || "Dividend"}</td>
                            <td className="text-right">{formatNumber(d.quantity, 2)}</td>
                            <td className="text-right">{formatNumber(d.dividend_per_share, 4)}</td>
                            <td className={`text-right font-medium ${profitColor(d.amount)}`}>{formatUSD(d.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ---- Deposits & Withdrawals ---- */}
            {paResult.report.deposits.length > 0 && (
              <section className="card space-y-4">
                <button onClick={() => setShowPaDeposits(v => !v)} className="w-full flex items-center gap-2 text-left">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <h3 className="text-base font-semibold text-white flex-1">Wplaty i wyplaty ({paResult.report.deposits.length})</h3>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPaDeposits ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPaDeposits && (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Data</th>
                          <th className="text-left">Typ</th>
                          <th className="text-left">Opis</th>
                          <th className="text-right">Kwota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paResult.report.deposits.map((dep, i) => (
                          <tr key={i}>
                            <td>{dep.entry_date}</td>
                            <td className={`font-medium ${dep.deposit_type === "DEPOSIT" ? "text-emerald-400" : dep.deposit_type === "TRNSFROUT" ? "text-red-400" : "text-slate-300"}`}>
                              {dep.deposit_type}
                            </td>
                            <td className="text-slate-400 max-w-[250px] truncate">{dep.description}</td>
                            <td className={`text-right font-medium ${profitColor(dep.amount)}`}>{formatUSD(dep.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ---- Warnings ---- */}
            {paResult.report.warnings.length > 0 && (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-4">
                <h3 className="text-sm font-semibold text-amber-400 mb-2">Ostrzezenia</h3>
                <ul className="text-xs text-amber-300 space-y-1">
                  {paResult.report.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      {/* ================================================================
          EDUCATION SECTION
          ================================================================ */}
      <section className="max-w-5xl mx-auto w-full px-6 pb-10">
        <div className="card space-y-4">
          <button
            onClick={() => setShowEdu((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h3 className="text-base font-semibold text-white flex-1">
              Baza wiedzy inwestora
            </h3>
            <svg
              className={`w-4 h-4 text-slate-400 transition-transform ${showEdu ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showEdu && (
            <div className="space-y-3">
              {/* --- Broker Download Instructions --- */}
              <EduAccordion
                title="Jak pobrac dane z brokera? (krok po kroku)"
                id="broker-guide"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="space-y-6">
                  {/* IBKR Stocks - Flex Query */}
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1 flex items-center gap-2">
                      <span className="bg-blue-500/15 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded">IBKR</span>
                      Interactive Brokers — Akcje (Flex Query)
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Flex Query pozwala wygenerowac precyzyjny raport z transakcjami. Akcje i dywidendy to OSOBNE raporty — najpierw eksportuj akcje.
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Zaloguj sie do Client Portal i przejdz do: Performance & Reports > Flex Queries' />
                      <BrokerStep step={2} text='Kliknij "Create" aby stworzyc nowy Flex Query' />
                      <BrokerStep step={3} text='Nadaj nazwe "stocks" i w sekcji Selections wybierz "Trades"' />
                      <BrokerStep step={4} text='Zaznacz "Select All" dla wszystkich kolumn, kliknij "Save"' />
                      <BrokerStep step={5} text='Dodaj tez: Corporate Actions (splity, spin-offy) i Transfers — rowniez "Select All" i Save' />
                      <BrokerStep step={6} text='Dodaj swoje konto, Format: "CSV", Include column headers: "Yes", kliknij "Continue"' />
                      <BrokerStep step={7} text='Kliknij "Create" aby zapisac raport' />
                      <BrokerStep step={8} text='Przy nazwie raportu kliknij strzalke > "Custom Date Range" > ustaw zakres (max 365 dni) > "Run"' />
                    </div>
                    <div className="mt-3 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                      <p className="text-[11px] text-blue-300">
                        <span className="font-semibold">Wazne:</span> Eksportuj raporty za WSZYSTKIE lata wstecz (gdy byly transakcje).
                        Max 365 dni na plik — generuj osobno za kazdy rok. Jesli migrowano konto — w Select Account(s)
                        zaznacz filtry &quot;Open&quot; i &quot;Migrated&quot; aby uwzglednic wszystkie konta.
                      </p>
                    </div>
                  </div>

                  {/* IBKR Dividends - Flex Query */}
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1 flex items-center gap-2">
                      <span className="bg-blue-500/15 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded">IBKR</span>
                      Interactive Brokers — Dywidendy (Flex Query)
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Osobny raport Flex Query dla dywidend i podatku u zrodla (WHT).
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Performance & Reports > Flex Queries > "Create"' />
                      <BrokerStep step={2} text='Nazwa: "dividends", w Selections wybierz "Cash Transactions"' />
                      <BrokerStep step={3} text='W Options zaznacz wszystko POZA "Summary", nastepnie "Select All" kolumn, Save' />
                      <BrokerStep step={4} text='Dodaj konto, Format: "CSV", Include column headers: "Yes", Continue' />
                      <BrokerStep step={5} text='Kliknij "Create"' />
                      <BrokerStep step={6} text='Przy nazwie raportu kliknij strzalke > "Custom Date Range" > ustaw rok > "Run"' />
                    </div>
                    <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <p className="text-[11px] text-emerald-300">
                        <span className="font-semibold">Wgraj OBA pliki</span> (akcje + dywidendy) do TaxPilot naraz.
                        System automatycznie rozpozna typ raportu i polaczy dane.
                      </p>
                    </div>
                  </div>

                  {/* Exante */}
                  <div>
                    <h4 className="text-sm font-semibold text-purple-400 mb-1 flex items-center gap-2">
                      <span className="bg-purple-500/15 text-purple-400 text-[10px] font-bold px-2 py-0.5 rounded">EXANTE</span>
                      Exante — Raport transakcji finansowych
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Exante pozwala wygenerowac raport niestandardowy (Custom Report) zawierajacy cala historie transakcji.
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Zaloguj sie do panelu handlowego Exante: exante.eu' />
                      <BrokerStep step={2} text='Z menu bocznego wybierz "Raporty" (Reports), nastepnie "Raporty niestandardowe" (Custom Reports)' />
                      <BrokerStep step={3} text='Kliknij "Dodaj personalizowany raport" (Add Custom Report)' />
                      <BrokerStep step={4} text='Waluta: wybierz "USD"' />
                      <BrokerStep step={5} text='Format: wybierz "CSV"' />
                      <BrokerStep step={6} text='Typ: wybierz "Transakcje finansowe" (Financial Transactions)' />
                      <BrokerStep step={7} text='Zakres dat: kliknij "+ Dodaj" i dodaj pelne lata — od 1 stycznia do 31 grudnia — od roku zalozenia konta do najnowszej daty. Np.: 2021-01-01 do 2021-12-31, potem 2022-01-01 do 2022-12-31, itd. Zakresy nie moga sie nakladac!' />
                      <BrokerStep step={8} text='Kliknij "Generate" — poczekaj chwile, odswierz strone i pobierz wygenerowany plik CSV' />
                      <BrokerStep step={9} text='Wgraj pobrany plik do TaxPilot' />
                    </div>
                    <div className="mt-3 rounded-lg bg-purple-500/10 border border-purple-500/20 px-3 py-2">
                      <p className="text-[11px] text-purple-300">
                        <span className="font-semibold">Wazne:</span> Raport musi obejmowac cala historie od poczatku konta, aby kalkulator
                        mogl prawidlowo obliczyc podatek metoda FIFO. Exante eksportuje wszystkie typy transakcji w jednym pliku
                        (kupna, sprzedaze, dywidendy, WHT, forex). TaxPilot automatycznie odfiltruje transakcje forex.
                      </p>
                    </div>
                  </div>

                  {/* Revolut */}
                  <div>
                    <h4 className="text-sm font-semibold text-orange-400 mb-1 flex items-center gap-2">
                      <span className="bg-orange-500/15 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded">REVOLUT</span>
                      Revolut — Wyciag z inwestycji
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Revolut udostepnia wyciag z transakcji gieldowych w formacie CSV.
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Otworz aplikacje Revolut lub zaloguj sie na app.revolut.com' />
                      <BrokerStep step={2} text='Przejdz do zakladki "Invest" / "Inwestycje"' />
                      <BrokerStep step={3} text='Kliknij ikone "..." (wiecej) lub "Statements" / "Wyciagi"' />
                      <BrokerStep step={4} text='Wybierz "Profit & Loss Statement" lub "Account Statement"' />
                      <BrokerStep step={5} text='Ustaw zakres dat: caly rok (np. 01.01.2024 - 31.12.2024)' />
                      <BrokerStep step={6} text='Format: CSV (lub Excel)' />
                      <BrokerStep step={7} text='Pobierz plik i wgraj do TaxPilot' />
                    </div>
                    <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                      <p className="text-[11px] text-amber-300">
                        <span className="font-semibold">Uwaga Revolut:</span> Revolut czesto zmienia format eksportu.
                        Jesli TaxPilot nie rozpozna pliku, sprobuj pobrac "Trading Activity Statement" zamiast
                        standardowego wyciagu. W razie problemow uzyj formularza recznego kupna.
                      </p>
                    </div>
                  </div>

                  {/* eToro */}
                  <div>
                    <h4 className="text-sm font-semibold text-green-400 mb-1 flex items-center gap-2">
                      <span className="bg-green-500/15 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded">ETORO</span>
                      eToro — Wyciag z konta
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      eToro pozwala pobrac wyciag z konta (Account Statement) w formacie Excel.
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Zaloguj sie na konto eToro i przejdz do zakladki "Portfel" / "Portfolio"' />
                      <BrokerStep step={2} text='Zmien widok na "Historia" / "History"' />
                      <BrokerStep step={3} text='Kliknij przycisk z dodatkowymi opcjami i wybierz "Wyciag z Konta" / "Account Statement"' />
                      <BrokerStep step={4} text='Ustaw mozliwie najdluzszy zakres dat — cala historia transakcji od poczatku konta' />
                      <BrokerStep step={5} text='Pobierz plik w formacie .xls lub .xlsx' />
                      <BrokerStep step={6} text='Wgraj plik do TaxPilot' />
                    </div>
                    <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
                      <p className="text-[11px] text-green-300">
                        <span className="font-semibold">Wazne:</span> Dlugi zakres dat jest niezbedny do prawidlowego rozpoznania
                        otwartych pozycji i obliczenia podatku metoda FIFO. Zachowaj plik w oryginalnym formacie (.xls/.xlsx).
                      </p>
                    </div>
                  </div>

                  {/* Freedom24 */}
                  <div>
                    <h4 className="text-sm font-semibold text-sky-400 mb-1 flex items-center gap-2">
                      <span className="bg-sky-500/15 text-sky-400 text-[10px] font-bold px-2 py-0.5 rounded">FREEDOM24</span>
                      Freedom24 — Raport brokera
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Freedom24 udostepnia raport brokera w formacie XLS.
                    </p>
                    <div className="space-y-2">
                      <BrokerStep step={1} text='Zaloguj sie do wersji webowej Freedom24' />
                      <BrokerStep step={2} text='Kliknij ikone menu (hamburger) w prawym gornym rogu' />
                      <BrokerStep step={3} text='Wybierz "Sprawozdanie" z menu' />
                      <BrokerStep step={4} text='Wybierz "Raport brokera" i zaznacz opcje "Za okres"' />
                      <BrokerStep step={5} text='Ustaw jak najszerszy mozliwy zakres dat — wszystkie lata wstecz od poczatku konta' />
                      <BrokerStep step={6} text='Potwierdz zielonym przyciskiem i pobierz plik XLS' />
                      <BrokerStep step={7} text='Wgraj plik do TaxPilot' />
                    </div>
                    <div className="mt-3 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2">
                      <p className="text-[11px] text-sky-300">
                        <span className="font-semibold">Uwaga:</span> Raport musi obejmowac cala historie — konieczne do prawidlowego
                        obliczenia podatku metoda FIFO. Obslugiwane sa pliki w formacie XLS.
                      </p>
                    </div>
                  </div>

                  {/* General tips */}
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3">
                    <h4 className="text-xs font-semibold text-slate-200 mb-2">Ogolne wskazowki</h4>
                    <ul className="space-y-1.5 text-[11px] text-slate-400">
                      <li className="flex gap-2">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">1.</span>
                        <span><span className="text-slate-300 font-medium">Pobierz dane z WSZYSTKICH lat</span> — jesli kupiles akcje w 2021, a sprzedales w 2024, potrzebujesz danych z obu lat.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">2.</span>
                        <span><span className="text-slate-300 font-medium">Plik z transakcjami + plik z dywidendami</span> — u niektorych brokerow (np. IBKR) to osobne pliki. Wgraj oba.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">3.</span>
                        <span><span className="text-slate-300 font-medium">Format CSV lub XLSX</span> — TaxPilot obsluguje oba. CSV jest preferowany (mniejszy, szybszy).</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">4.</span>
                        <span><span className="text-slate-300 font-medium">Kilku brokerow?</span> — wgraj pliki ze wszystkich brokerow naraz. System polaczy transakcje automatycznie.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">5.</span>
                        <span><span className="text-slate-300 font-medium">Brakuje starych plikow?</span> — uzyj sekcji &quot;Uzupelnij brakujace kupna&quot; aby wpisac historyczne kupna recznie.</span>
                      </li>
                    </ul>
                  </div>

                  {/* What data is needed */}
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3">
                    <h4 className="text-xs font-semibold text-slate-200 mb-2">Jakie dane sa potrzebne?</h4>
                    <p className="text-[11px] text-slate-400 mb-2">
                      TaxPilot automatycznie wyciagnie potrzebne informacje z pliku. Upewnij sie, ze raport zawiera:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="bg-slate-900/50 rounded px-3 py-2">
                        <p className="text-[10px] font-semibold text-emerald-400 mb-1">Dla akcji/ETF (kupno i sprzedaz):</p>
                        <ul className="text-[11px] text-slate-400 space-y-0.5">
                          <li>- Symbol waloru (np. AAPL, VWCE.DE)</li>
                          <li>- Data transakcji</li>
                          <li>- Ilosc (quantity)</li>
                          <li>- Cena za sztuke</li>
                          <li>- Waluta (USD, EUR...)</li>
                          <li>- Prowizja / NetCash</li>
                        </ul>
                      </div>
                      <div className="bg-slate-900/50 rounded px-3 py-2">
                        <p className="text-[10px] font-semibold text-purple-400 mb-1">Dla dywidend:</p>
                        <ul className="text-[11px] text-slate-400 space-y-0.5">
                          <li>- Symbol waloru</li>
                          <li>- Data wyplaty</li>
                          <li>- Kwota brutto dywidendy</li>
                          <li>- Waluta</li>
                          <li>- Podatek u zrodla (WHT)</li>
                          <li>- ISIN (opcjonalnie, do identyfikacji kraju)</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </EduAccordion>

              {/* --- Glossary --- */}
              <EduAccordion
                title="Slownik pojec"
                id="glossary"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <GlossaryItem term="FIFO (First In, First Out)" definition="Metoda parowania transakcji: sprzedaz jest parowana z najstarszym kupnem tego samego waloru. Wymagana przez polskie prawo podatkowe (art. 30a ust. 3 ustawy o PIT)." />
                  <GlossaryItem term="PIT-38" definition="Formularz zeznania rocznego o wysokosci osiagnietego dochodu z kapitalow pienieznych. Sklada sie do 30 kwietnia za rok poprzedni." />
                  <GlossaryItem term="PIT/ZG" definition="Zalacznik do PIT-36 lub PIT-38 — informacja o dochodach/stratach z zagranicy. Osobny dla kazdego kraju, z ktorego uzyskano dochod." />
                  <GlossaryItem term="WHT (Withholding Tax)" definition="Podatek u zrodla — pobrany automatycznie przez zagraniczny kraj w momencie wyplaty dywidendy. Np. USA pobiera 15% (z W-8BEN) lub 30% (bez W-8BEN)." />
                  <GlossaryItem term="NBP (Narodowy Bank Polski)" definition="Bank centralny Polski. Publikuje tabele kursow srednich walut obcych (tabela A), ktore sa podstawa do przeliczenia transakcji na PLN." />
                  <GlossaryItem term="Kurs NBP" definition="Sredni kurs waluty z tabeli A NBP z ostatniego dnia roboczego POPRZEDZAJACEGO dzien rozliczenia (settlement date). Podstawa prawna: art. 11a ust. 1 ustawy o PIT." />
                  <GlossaryItem term="Settlement date" definition="Data rozliczenia transakcji (nie data zlozenia zlecenia). Dla rynku US/CA/MX od 28.05.2024 wynosi T+1, dla pozostalych T+2 (dni robocze)." />
                  <GlossaryItem term="Trade date" definition="Data faktycznego zawarcia transakcji (zlozenia zlecenia na gieldzie). Rozni sie od settlement date o 1-2 dni robocze." />
                  <GlossaryItem term="ISIN" definition="Miedzynarodowy numer identyfikujacy papier wartosciowy. Pierwsze 2 znaki to kod kraju emitenta (np. US = USA, IE = Irlandia)." />
                  <GlossaryItem term="Przychod (poz. 22 PIT-38)" definition="Kwota uzyskana ze sprzedazy papierow wartosciowych, przeliczona na PLN po kursie NBP z dnia rozliczenia. Pomniejszona o prowizje sprzedazy." />
                  <GlossaryItem term="Koszty (poz. 23 PIT-38)" definition="Koszt nabycia sprzedanych papierow: cena kupna + prowizja kupna, przeliczone na PLN po kursie NBP z dnia rozliczenia kupna." />
                  <GlossaryItem term="Strata podatkowa" definition="Gdy koszty przewyzszaja przychod. Mozna odliczyc w ciagu nastepnych 5 lat, max 50% straty rocznie (art. 9 ust. 3 ustawy o PIT)." />
                  <GlossaryItem term="W-8BEN" definition="Formularz IRS potwierdzajacy status podatkowy nierezydenta USA. Obniza WHT z dywidend amerykanskich z 30% do 15% na mocy umowy PL-US." />
                  <GlossaryItem term="ETF (Exchange-Traded Fund)" definition="Fundusz inwestycyjny notowany na gieldzie. Opodatkowany tak samo jak akcje — zysk ze sprzedazy rozliczasz w PIT-38." />
                  <GlossaryItem term="Akcja korporacyjna (Corporate Action)" definition="Zdarzenie jak split, reverse split, spin-off, merger. Moze zmienic ilosc lub cene akcji w portfelu bez transakcji kupna/sprzedazy." />
                  <GlossaryItem term="Broker" definition="Posrednik umozliwiajacy handel papierami wartosciowymi. Popularne: Interactive Brokers (IBKR), Exante, Revolut, XTB, mBank eMakler." />
                </div>
              </EduAccordion>

              {/* --- WHT Treaty Rates --- */}
              <EduAccordion
                title="Stawki WHT wg umow o unikaniu podwojnego opodatkowania"
                id="wht-rates"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <p className="text-xs text-slate-400 mb-3">
                  Ponizsze stawki dotycza podatku u zrodla od dywidend dla polskich rezydentow podatkowych.
                  Wymagany formularz W-8BEN (USA) lub odpowiednik dla danego kraju.
                </p>
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-xs">
                    <thead>
                      <tr>
                        <th>Kraj</th>
                        <th>Stawka WHT</th>
                        <th>Stawka bez umowy</th>
                        <th>Formularz</th>
                        <th>Uwagi</th>
                      </tr>
                    </thead>
                    <tbody>
                      <WhtRow country="USA" rate="15%" noTreaty="30%" form="W-8BEN" note="Najczestsza — wiekszosc akcji na NYSE/NASDAQ" />
                      <WhtRow country="Irlandia" rate="15%" noTreaty="25%" form="n/d" note="Wiele ETF-ow europejskich (UCITS) ma siedzibe w IE" />
                      <WhtRow country="Luksemburg" rate="15%" noTreaty="15%" form="n/d" note="Fundusze UCITS, spolki holdingowe" />
                      <WhtRow country="Niemcy" rate="15%" noTreaty="26.375%" form="n/d" note="DAX, XETRA — niemieckie spolki" />
                      <WhtRow country="Wielka Brytania" rate="0%" noTreaty="0%" form="n/d" note="UK nie pobiera WHT od dywidend" />
                      <WhtRow country="Holandia" rate="10%" noTreaty="15%" form="n/d" note="AEX — spolki holenderskie" />
                      <WhtRow country="Francja" rate="15%" noTreaty="30%" form="n/d" note="CAC 40 — spolki francuskie" />
                      <WhtRow country="Szwajcaria" rate="15%" noTreaty="35%" form="n/d" note="Wysoka stawka bez umowy!" />
                      <WhtRow country="Kanada" rate="15%" noTreaty="25%" form="NR301" note="TSX — spolki kanadyjskie" />
                      <WhtRow country="Japonia" rate="10%" noTreaty="20.42%" form="n/d" note="Nikkei — spolki japonskie" />
                      <WhtRow country="Australia" rate="15%" noTreaty="30%" form="n/d" note="ASX — spolki australijskie" />
                      <WhtRow country="Norwegia" rate="15%" noTreaty="25%" form="n/d" note="OBX — spolki norweskie" />
                      <WhtRow country="Szwecja" rate="15%" noTreaty="30%" form="n/d" note="OMX — spolki szwedzkie" />
                      <WhtRow country="Dania" rate="15%" noTreaty="27%" form="n/d" note="OMX — spolki dunskie" />
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Stawki orientacyjne na 2024 r. Sprawdz aktualna umowe na stronie Ministerstwa Finansow.
                  Rzeczywista stawka moze zalezec od rodzaju dochodu i statusu beneficjenta.
                </p>
              </EduAccordion>

              {/* --- FAQ --- */}
              <EduAccordion
                title="Najczesciej zadawane pytania (FAQ)"
                id="faq"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="space-y-4">
                  <FaqItem
                    question="Czy muszem rozliczac kazda transakcje osobno?"
                    answer="Nie — w PIT-38 wpisujesz laczna kwote przychodu (poz. 22) i kosztow (poz. 23). Szczegolowe parowania FIFO zachowujesz w dokumentacji na wypadek kontroli skarbowej."
                  />
                  <FaqItem
                    question="Co jesli mialem same straty w danym roku?"
                    answer="Wpisujesz strate w poz. 27 PIT-38. Podatek wynosi 0 zl. Strate mozesz odliczyc od zyskow w nastepnych 5 latach (max 50% straty rocznie). PIT-38 skladasz nawet jezeli masz sama strate."
                  />
                  <FaqItem
                    question="Czy muszem skladac PIT-38 jesli nie sprzedawalem akcji?"
                    answer="Jesli w danym roku nie sprzedawales papierow wartosciowych i nie uzyskales zyskow kapitalowych — nie musisz skladac PIT-38. Ale jesli miales dywidendy zagraniczne, rozliczasz je w PIT-36."
                  />
                  <FaqItem
                    question="Jaki kurs NBP stosowac?"
                    answer="Sredni kurs z tabeli A NBP z ostatniego dnia roboczego POPRZEDZAJACEGO date rozliczenia (settlement date), a nie date transakcji (trade date). Art. 11a ust. 1 ustawy o PIT."
                  />
                  <FaqItem
                    question="Czy prowizje brokerskie odliczam od podatku?"
                    answer="Tak — prowizja kupna zwieksza koszt nabycia (poz. 23), a prowizja sprzedazy pomniejsza przychod (poz. 22). Efektywnie obnizaja zysk i podatek."
                  />
                  <FaqItem
                    question="Co z podatkiem od dywidend amerykanskich (W-8BEN)?"
                    answer="USA pobiera 15% WHT (z W-8BEN). Polska wymaga 19%. Roznице (19% - 15% = 4%) doplaczasz w Polsce. Bez W-8BEN USA pobiera 30% — nadwyzke nad 19% nie odzyskasz automatycznie."
                  />
                  <FaqItem
                    question="Czy ETF-y sa opodatkowane tak samo jak akcje?"
                    answer="Tak — zysk ze sprzedazy ETF (np. VWCE, CSPX) rozliczasz identycznie jak akcje w PIT-38 metoda FIFO. Dywidendy z ETF-ow dystrybucyjnych rowniez podlegaja opodatkowaniu."
                  />
                  <FaqItem
                    question="Co to jest T+1 i T+2?"
                    answer="Czas rozliczenia transakcji. T+1 = 1 dzien roboczy po transakcji (US/CA/MX od 28.05.2024). T+2 = 2 dni robocze (Europa, Azja). Wazne dla ustalenia kursu NBP."
                  />
                  <FaqItem
                    question="Jak rozliczyc split akcji (np. 4:1)?"
                    answer="Split zmienia ilosc i cene akcji, ale nie wartosc. Jesli miales 10 akcji po 400 USD i nastapil split 4:1, masz 40 akcji po 100 USD. Koszt nabycia laczny sie nie zmienia. TaxPilot nie obsluguje automatycznie splitow — moze byc konieczna reczna korekta."
                  />
                  <FaqItem
                    question="Do kiedy musze zlozyc PIT-38?"
                    answer="Do 30 kwietnia roku nastepnego po roku podatkowym. Za 2024 rok — do 30 kwietnia 2025. Mozna zlozyc elektronicznie przez e-Deklaracje lub Twoj e-PIT."
                  />
                  <FaqItem
                    question="Czy moge rozliczac kilka brokerow na jednym PIT-38?"
                    answer="Tak — laczsz wszystkie transakcje ze wszystkich brokerow i wpisujesz laczne kwoty w PIT-38. TaxPilot obsluguje jednoczesne wgranie plikow z roznych brokerow."
                  />
                  <FaqItem
                    question="Co jesli WHT jest wyzszy niz polski podatek od dywidend?"
                    answer="Doplata w Polsce wynosi 0 zl (nie moze byc ujemna). Nadwyzki WHT ponad 19% nie odzyskasz automatycznie w Polsce — mozesz sprobowac ubiegac sie o zwrot w kraju zrodla."
                  />
                </div>
              </EduAccordion>

              {/* --- Common Mistakes --- */}
              <EduAccordion
                title="Najczestsze bledy przy rozliczaniu"
                id="mistakes"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="space-y-3">
                  <MistakeItem
                    number={1}
                    title="Uzycie kursu z dnia transakcji zamiast dnia rozliczenia"
                    description="Kurs NBP bierze sie z dnia roboczego PRZED settlement date, nie trade date. Roznica T+1/T+2 zmienia kurs i moze wplynac na obliczenia."
                  />
                  <MistakeItem
                    number={2}
                    title="Brak PIT-38 przy samej stracie"
                    description="Nawet jesli masz same straty, musisz zlozyc PIT-38. Bez tego nie bedziesz mogl odliczyc straty w przyszlosci."
                  />
                  <MistakeItem
                    number={3}
                    title="Niezlozenie W-8BEN u brokera"
                    description="Bez W-8BEN USA pobiera 30% WHT zamiast 15%. Nadwyzka ponad 19% polskiego podatku to strata — nie odliczysz jej w PIT."
                  />
                  <MistakeItem
                    number={4}
                    title="Pominiecie dywidend w rozliczeniu"
                    description="Dywidendy zagraniczne musisz rozliczyc w PIT-36 (nie PIT-38!), nawet jesli broker juz pobral WHT. Brak rozliczenia to zaleglosc podatkowa."
                  />
                  <MistakeItem
                    number={5}
                    title="Brak zalacznika PIT/ZG"
                    description="Jesli uzyskujesz dochody z zagranicy, musisz dolaczyc PIT/ZG — osobny dla kazdego kraju. Bez tego PIT jest niekompletny."
                  />
                  <MistakeItem
                    number={6}
                    title="Stosowanie LIFO zamiast FIFO"
                    description="Polskie prawo wymaga metody FIFO (First In, First Out). Sprzedaz ZAWSZE paruje sie z najstarszym kupnem, nie najnowszym."
                  />
                  <MistakeItem
                    number={7}
                    title="Nieuwzglednienie prowizji w kosztach"
                    description="Prowizje brokerskie sa czescia kosztu nabycia (przy kupnie) i pomniejszaja przychod (przy sprzedazy). Pominiecie ich zawyza podatek."
                  />
                  <MistakeItem
                    number={8}
                    title="Odliczenie ponad 50% straty z lat ubieglych"
                    description="W jednym roku mozesz odliczyc max 50% lacznej straty z lat ubieglych. Reszta przechodzi na kolejne lata (lacznie max 5 lat)."
                  />
                  <MistakeItem
                    number={9}
                    title="Podwojne rozliczenie tej samej transakcji"
                    description="Jesli wgrywasz pliki z kilku lat, upewnij sie ze nie dupllikujesz transakcji. TaxPilot filtruje po roku podatkowym, ale identyczne pliki moga powodowac podwojenia."
                  />
                  <MistakeItem
                    number={10}
                    title="Ignorowanie akcji korporacyjnych (split, spin-off)"
                    description="Split/reverse split zmienia ilosc i cene akcji. Jesli broker nie uwzglednil tego w CSV, parowanie FIFO moze byc nieprawidlowe."
                  />
                </div>
              </EduAccordion>

              {/* --- Useful Links --- */}
              <EduAccordion
                title="Przydatne linki i zasoby"
                id="links"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <LinkCard
                    title="e-Deklaracje"
                    url="https://www.podatki.gov.pl/e-deklaracje/"
                    description="Elektroniczne skladanie PIT-38, PIT-36 i zalacznikow"
                  />
                  <LinkCard
                    title="Twoj e-PIT"
                    url="https://www.podatki.gov.pl/pit/twoj-e-pit/"
                    description="Wstepnie wypelnione zeznanie podatkowe"
                  />
                  <LinkCard
                    title="Kursy NBP — Tabela A"
                    url="https://www.nbp.pl/home.aspx?f=/kursy/kursya.html"
                    description="Aktualne i archiwalne kursy srednich walut obcych"
                  />
                  <LinkCard
                    title="API NBP"
                    url="https://api.nbp.pl/"
                    description="Programistyczny dostep do kursow NBP (uzywa TaxPilot)"
                  />
                  <LinkCard
                    title="Ustawa o PIT"
                    url="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350"
                    description="Pelny tekst ustawy o podatku dochodowym od osob fizycznych"
                  />
                  <LinkCard
                    title="Umowy o unikaniu podwojnego opodatkowania"
                    url="https://www.podatki.gov.pl/podatkowa-wspolpraca-miedzynarodowa/umowy-o-unikaniu-podwojnego-opodatkowania/"
                    description="Lista umow PL z innymi krajami — stawki WHT"
                  />
                  <LinkCard
                    title="Krajowa Administracja Skarbowa"
                    url="https://www.kas.gov.pl/"
                    description="Informacje o podatkach, kontakt z urzedem skarbowym"
                  />
                  <LinkCard
                    title="IRS W-8BEN"
                    url="https://www.irs.gov/forms-pubs/about-form-w-8-ben"
                    description="Formularz W-8BEN — obnizenie WHT z USA do 15%"
                  />
                </div>
              </EduAccordion>

              {/* --- Tax Calendar --- */}
              <EduAccordion
                title="Kalendarz podatkowy inwestora"
                id="calendar"
                activeId={eduSection}
                onToggle={setEduSection}
              >
                <div className="space-y-3">
                  <CalendarItem
                    date="Styczen - Luty"
                    title="Pobierz raporty z brokera"
                    description="Pobierz roczne potwierdzenia transakcji (Activity Statements, Flex Queries) ze wszystkich brokerow za miniony rok. Upewnij sie, ze masz pelna historie kupna."
                  />
                  <CalendarItem
                    date="Luty - Marzec"
                    title="Oblicz podatek"
                    description="Uzyj TaxPilot lub innego narzedzia do obliczenia zyskow kapitalowych (FIFO), dywidend i podatku naleznego. Zweryfikuj wyniki."
                  />
                  <CalendarItem
                    date="15 lutego"
                    title="PIT-8C od polskich brokerow"
                    description="Polscy brokerzy (XTB, mBank) wysylaja PIT-8C do 15 lutego. Zagraniczni brokerzy (IBKR, Exante) NIE wysylaja PIT-8C — musisz obliczyc sam."
                  />
                  <CalendarItem
                    date="Do 30 kwietnia"
                    title="Zloz PIT-38 + PIT/ZG"
                    description="Termin zlozenia PIT-38 (zyski kapitalowe) i PIT/ZG (dochody z zagranicy). Mozna elektronicznie przez e-Deklaracje lub Twoj e-PIT."
                  />
                  <CalendarItem
                    date="Do 30 kwietnia"
                    title="Zloz PIT-36 (dywidendy zagraniczne)"
                    description="Jesli miales dywidendy z zagranicznych spolek — rozlicz je w PIT-36 Czesc G. Dolacz PIT/ZG."
                  />
                  <CalendarItem
                    date="Do 30 kwietnia"
                    title="Wplac podatek"
                    description="Przelej nalezny podatek na indywidualny mikrorachunek podatkowy (IRP). Numer sprawdzisz na stronie podatki.gov.pl."
                  />
                </div>
              </EduAccordion>
            </div>
          )}
        </div>
      </section>

      {/* ================================================================
          FOOTER
          ================================================================ */}
      <footer className="border-t border-slate-800 bg-[#0d1117] mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center space-y-2">
          <p className="text-xs text-slate-500">
            TaxPilot jest narzedziem pomocniczym. Wyniki nie stanowia porady
            podatkowej. Zweryfikuj obliczenia z doradca podatkowym przed
            zlozeniem deklaracji PIT-38.
          </p>
          <p className="text-xs text-slate-600">
            &copy; {new Date().getFullYear()} TaxPilot. Kursy walut NBP.
            Metoda FIFO zgodna z art. 30b ustawy o PIT.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  color = "text-slate-200",
  highlight = false,
}: {
  label: string;
  value: string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-4 py-3 ${
        highlight
          ? "bg-amber-500/10 border border-amber-500/20"
          : "bg-slate-800/60"
      }`}
    >
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function InfoBox({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <svg
          className="w-4 h-4 text-blue-400 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="font-medium">{title}</span>
        <svg
          className={`w-4 h-4 ml-auto transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-sm leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function FormFieldRow({
  field,
  label,
  value,
  description,
  highlight = false,
}: {
  field: string;
  label: string;
  value: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
        highlight ? "bg-orange-500/10 border border-orange-500/15" : "bg-slate-800/50"
      }`}
    >
      <span className="flex-shrink-0 bg-slate-700 text-orange-300 text-[10px] font-bold px-2 py-1 rounded mt-0.5 min-w-[60px] text-center">
        {field}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-300 font-medium">{label}</span>
          <span className={`text-sm font-semibold flex-shrink-0 ${highlight ? "text-orange-300" : "text-slate-100"}`}>
            {value}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Education sub-components
// ---------------------------------------------------------------------------

function EduAccordion({
  title,
  id,
  activeId,
  onToggle,
  children,
}: {
  title: string;
  id: string;
  activeId: string | null;
  onToggle: (id: string | null) => void;
  children: React.ReactNode;
}) {
  const isOpen = activeId === id;
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      <button
        onClick={() => onToggle(isOpen ? null : id)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="font-medium flex-1 text-left">{title}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-sm leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function GlossaryItem({ term, definition }: { term: string; definition: string }) {
  return (
    <div className="bg-slate-800/50 rounded-lg px-3 py-2.5">
      <p className="text-xs font-semibold text-violet-300 mb-1">{term}</p>
      <p className="text-[11px] text-slate-400 leading-relaxed">{definition}</p>
    </div>
  );
}

function WhtRow({
  country,
  rate,
  noTreaty,
  form,
  note,
}: {
  country: string;
  rate: string;
  noTreaty: string;
  form: string;
  note: string;
}) {
  return (
    <tr>
      <td className="font-medium text-slate-200">{country}</td>
      <td className="text-emerald-400 font-semibold">{rate}</td>
      <td className="text-red-400">{noTreaty}</td>
      <td className="text-slate-400">{form}</td>
      <td className="text-slate-500 text-[11px]">{note}</td>
    </tr>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-slate-800/50 rounded-lg px-4 py-3">
      <p className="text-xs font-semibold text-slate-200 mb-1.5">{question}</p>
      <p className="text-[11px] text-slate-400 leading-relaxed">{answer}</p>
    </div>
  );
}

function MistakeItem({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 bg-red-500/5 border border-red-500/10 rounded-lg px-4 py-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500/20 text-red-400 text-xs font-bold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-200 mb-1">{title}</p>
        <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function LinkCard({
  title,
  url,
  description,
}: {
  title: string;
  url: string;
  description: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-slate-800/50 hover:bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 rounded-lg px-4 py-3 transition-colors group"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-blue-400 group-hover:text-blue-300">{title}</span>
        <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </div>
      <p className="text-[11px] text-slate-500">{description}</p>
    </a>
  );
}

function CalendarItem({
  date,
  title,
  description,
}: {
  date: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-shrink-0 bg-violet-500/15 text-violet-400 text-[10px] font-bold px-2.5 py-1 rounded min-w-[90px] text-center mt-0.5">
        {date}
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-200 mb-0.5">{title}</p>
        <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function BrokerStep({ step, text }: { step: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[11px] font-bold flex items-center justify-center mt-0.5">
        {step}
      </span>
      <p className="text-[12px] text-slate-300 leading-relaxed">{text}</p>
    </div>
  );
}
