import { useState, useEffect, type FormEvent } from "react";
import { Player } from "@remotion/player";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EAComposition } from "@/remotion/EAComposition";
import {
  TerminalSquare,
  Loader2,
  TrendingUp,
  Crosshair,
  Zap,
  ShieldCheck,
  BarChart2,
  Code2,
  Download,
  SlidersHorizontal,
  Play,
  MessageSquare,
  X,
  ArrowRight,
  Check,
} from "lucide-react";

/* ── Auth modal ────────────────────────────────────────────── */

function AuthModal({
  onClose,
  initialMode,
}: {
  onClose: () => void;
  initialMode: "signin" | "signup";
}) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const fn = mode === "signin" ? signIn : signUp;
    const { error: err } = await fn(email, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (mode === "signup") {
      setInfo("Check your email to confirm your account, then sign in.");
      setMode("signin");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-7 relative shadow-2xl lp-fade-up">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-6">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 border border-primary/25">
            <TerminalSquare className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-none">EAbuilder</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "signin" ? "Sign in to your workstation" : "Create your account"}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lp-email">Email</Label>
            <Input
              id="lp-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-password">Password</Label>
            <Input
              id="lp-password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {info && <p className="text-xs text-emerald-400">{info}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

/* ── Data ──────────────────────────────────────────────────── */

const BRAINS = [
  {
    icon: TrendingUp,
    dot: "bg-emerald-400",
    border: "border-l-emerald-500/60",
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-950/60",
    badge: "gBias",
    badgeColor: "text-emerald-400 bg-emerald-950/50",
    title: "Direction brain",
    body: "Reads market bias (Bull / Bear / Neutral) from the higher timeframe using trend and structure logic. Stays persistent across bars.",
  },
  {
    icon: Crosshair,
    dot: "bg-blue-400",
    border: "border-l-blue-500/60",
    iconColor: "text-blue-400",
    iconBg: "bg-blue-950/60",
    badge: "gSetupActive",
    badgeColor: "text-blue-400 bg-blue-950/50",
    title: "Setup brain",
    body: "Identifies high-probability zones — FVG, OB, liquidity sweeps — on the setup timeframe. Resets every bar.",
  },
  {
    icon: Zap,
    dot: "bg-red-400",
    border: "border-l-red-500/60",
    iconColor: "text-red-400",
    iconBg: "bg-red-950/60",
    badge: "gExecSignal",
    badgeColor: "text-red-400 bg-red-950/50",
    title: "Execution brain",
    body: "Fires the precise entry — BOS, engulfing candle, or divergence — on the fastest timeframe. Resets every bar.",
  },
  {
    icon: ShieldCheck,
    dot: "bg-amber-400",
    border: "border-l-amber-500/60",
    iconColor: "text-amber-400",
    iconBg: "bg-amber-950/60",
    badge: "Deterministic",
    badgeColor: "text-amber-400 bg-amber-950/50",
    title: "Management brain",
    body: "Risk %, R:R ratio, break-even, trailing stop. Fully deterministic — never AI-invented. Numbers come from your description.",
  },
] as const;

const FEATURES = [
  {
    icon: BarChart2,
    title: "Verified modules only",
    body: "EMA, FVG, BOS, OB, Liquidity Sweep, RSI Divergence. Each is a battle-tested inline state machine — not generated on the fly.",
  },
  {
    icon: Code2,
    title: "AI wires, not writes",
    body: "AI maps your intent to module configurations. The assembler embeds proven MQL5 logic. Hallucinations cannot ship.",
  },
  {
    icon: Download,
    title: "Single self-contained file",
    body: "One .mq5 file with everything inline. No external indicators, no DLLs, no extra installation steps in MetaTrader.",
  },
  {
    icon: SlidersHorizontal,
    title: "Visual 4-Brain builder",
    body: "Assign modules to brains visually. Set timeframes and parameters through a UI — no need to touch any code.",
  },
  {
    icon: Play,
    title: "Instant backtest",
    body: "The desktop companion compiles the EA and opens MT5 Strategy Tester in one click from the browser.",
  },
  {
    icon: MessageSquare,
    title: "AI compile fixer",
    body: "Paste a compile error into the chat. AI patches the EA and re-emits the corrected file immediately.",
  },
] as const;

const MODULES = [
  { name: "EMA Cross", cat: "Trend" },
  { name: "FVG", cat: "SMC" },
  { name: "BOS / CHoCH", cat: "Structure" },
  { name: "Order Block", cat: "SMC" },
  { name: "Liquidity Sweep", cat: "SMC" },
  { name: "RSI Divergence", cat: "Momentum" },
  { name: "Engulfing", cat: "Price Action" },
  { name: "IFVG", cat: "SMC" },
  { name: "ATR Filter", cat: "Volatility" },
  { name: "Session Filter", cat: "Time" },
  { name: "Spread Filter", cat: "Execution" },
  { name: "Break-even", cat: "Management" },
  { name: "Trailing Stop", cat: "Management" },
  { name: "Fixed R:R", cat: "Management" },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Describe your strategy",
    body: "Type your logic in plain English. EAbuilder extracts timeframes, entry conditions, filters, and risk rules automatically.",
  },
  {
    n: "02",
    title: "Review the blueprint",
    body: "AI maps your logic to the 4-Brain model using verified building blocks. You see the exact wiring before any code is generated.",
  },
  {
    n: "03",
    title: "Download and compile",
    body: "Get a single self-contained .mq5 file. Compile in MetaEditor and run a backtest in MT5 immediately.",
  },
] as const;

/* ── Remotion Player wrapper — client-only ─────────────────── */

function HeroPlayer() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    /* Explicit aspect-ratio wrapper so the Player gets a real height */
    <div style={{ aspectRatio: "720 / 440", width: "100%" }}>
      {mounted ? (
        <Player
          component={EAComposition}
          durationInFrames={150}
          fps={30}
          compositionWidth={720}
          compositionHeight={440}
          loop
          autoPlay
          controls={false}
          clickToPlay={false}
          acknowledgeRemotionLicense
          style={{ width: "100%", height: "100%", borderRadius: "0.75rem" }}
        />
      ) : (
        <div className="w-full h-full rounded-xl bg-card border border-border/50 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}

/* ── Landing page ──────────────────────────────────────────── */

export function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");

  const openAuth = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} initialMode={authMode} />
      )}

      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm tracking-tight">
              EA<span className="text-primary">builder</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => openAuth("signin")}
            >
              Sign in
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => openAuth("signup")}
            >
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative border-b border-border/40">
        {/* Subtle radial glow behind hero content */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.63 0.24 262 / 0.35) 0%, transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative max-w-7xl mx-auto px-6 py-24 lg:py-32 grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-center">
          {/* ── Left — copy ──────────────────────────── */}
          <div>
            {/* Eyebrow */}
            <div className="lp-fade-in inline-flex items-center gap-2 text-[11px] font-mono tracking-widest uppercase text-primary/80 bg-primary/8 border border-primary/20 rounded-full px-3.5 py-1.5 mb-8">
              MT5 Expert Advisor Builder
            </div>

            {/* H1 — font-black for impact */}
            <h1 className="lp-fade-up lp-d1 text-5xl md:text-6xl lg:text-[3.75rem] xl:text-[4.25rem] font-black leading-[1.06] tracking-tight mb-6">
              Build trading EAs{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.72 0.2 260) 0%, oklch(0.78 0.18 200) 100%)",
                }}
              >
                without writing MQL5
              </span>
              .
            </h1>

            {/* Sub */}
            <p className="lp-fade-up lp-d2 text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
              Describe any strategy in plain English. EAbuilder maps it to
              verified modules and generates a compilable, self-contained Expert
              Advisor.
            </p>

            {/* CTAs */}
            <div className="lp-fade-up lp-d3 flex flex-wrap items-center gap-3 mb-8">
              <Button
                size="lg"
                className="gap-2 px-6"
                onClick={() => openAuth("signup")}
              >
                Start building free
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => openAuth("signin")}
              >
                Sign in
              </Button>
            </div>

            {/* Trust row */}
            <div className="lp-fade-up lp-d4 flex flex-wrap gap-3">
              {[
                "No credit card required",
                "28+ verified modules",
                "Always compiles",
              ].map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Check className="h-3 w-3 text-primary/70 shrink-0" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* ── Right — Remotion animation ───────────── */}
          <div className="lp-fade-in lp-d3 w-full">
            {/* Glow ring behind the player */}
            <div className="relative">
              <div
                className="pointer-events-none absolute -inset-4 rounded-2xl opacity-20 blur-2xl"
                style={{
                  background:
                    "oklch(0.63 0.24 262 / 0.6)",
                }}
                aria-hidden
              />
              <div className="relative rounded-xl overflow-hidden border border-white/8 shadow-2xl">
                <HeroPlayer />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ─────────────────────────────────── */}
      <section className="border-b border-border/40 bg-card/30">
        <div className="max-w-7xl mx-auto px-6 py-7 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 md:divide-x divide-border/40">
          {[
            { value: "28+", label: "Verified modules" },
            { value: "4", label: "Independent brains" },
            { value: "1", label: "File output" },
            { value: "100%", label: "Compilation rate" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center md:items-start md:px-10 gap-0.5">
              <span className="text-2xl font-black tracking-tight text-foreground">
                {s.value}
              </span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] font-mono text-primary/70 uppercase tracking-widest mb-3">
              How it works
            </p>
            <h2 className="text-3xl font-black tracking-tight">
              Three steps from idea to EA
            </h2>
          </div>

          {/* Steps with connectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connector line — desktop only */}
            <div
              className="hidden md:block absolute top-8 left-[calc(33.33%+1rem)] right-[calc(33.33%+1rem)] h-px"
              style={{ background: "linear-gradient(90deg, transparent, oklch(0.63 0.24 262 / 0.4), transparent)" }}
              aria-hidden
            />

            {STEPS.map((s) => (
              <div
                key={s.n}
                className="relative bg-card border border-border/60 rounded-xl p-6 hover:border-primary/30 transition-colors"
              >
                {/* Step number */}
                <div
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-primary/25 bg-primary/10 text-sm font-black font-mono text-primary mb-4"
                >
                  {s.n}
                </div>
                <h3 className="font-semibold text-sm mb-2">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4-Brain architecture ────────────────────────── */}
      <section className="py-24 px-6 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] font-mono text-primary/70 uppercase tracking-widest mb-3">
              Architecture
            </p>
            <h2 className="text-3xl font-black tracking-tight mb-3">
              The 4-Brain model
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Every EA runs four independent brains on separate timeframes. A
              trade fires only when all active brains agree.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {BRAINS.map((b) => (
              <div
                key={b.title}
                className={cn(
                  "bg-card border border-border/60 border-l-2 rounded-xl p-6",
                  "hover:bg-card/80 transition-colors",
                  b.border
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={cn(
                      "flex items-center justify-center w-9 h-9 rounded-lg",
                      b.iconBg
                    )}
                  >
                    <b.icon className={cn("h-4 w-4", b.iconColor)} />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-mono px-2 py-1 rounded-md",
                      b.badgeColor
                    )}
                  >
                    {b.badge}
                  </span>
                </div>
                <h3 className="text-sm font-semibold mb-1.5">{b.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {b.body}
                </p>
              </div>
            ))}
          </div>

          {/* Confluence note */}
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
            <div className="flex -space-x-1">
              {(["bg-emerald-500", "bg-blue-500", "bg-red-500", "bg-amber-500"] as const).map(
                (c, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full border border-background lp-dot-pulse",
                      c
                    )}
                    style={{ animationDelay: `${i * 0.4}s` }}
                  />
                )
              )}
            </div>
            <p className="text-xs text-primary/80 font-mono">
              ConfluenceGate() — trade fires only when all active brains agree
            </p>
          </div>
        </div>
      </section>

      {/* ── Module ticker ────────────────────────────────── */}
      <section className="py-14 border-t border-border/40 overflow-hidden relative">
        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10" style={{ background: "linear-gradient(90deg, var(--color-background), transparent)" }} aria-hidden />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10" style={{ background: "linear-gradient(270deg, var(--color-background), transparent)" }} aria-hidden />

        <div className="text-center mb-8">
          <p className="text-[11px] font-mono text-primary/70 uppercase tracking-widest mb-2">
            Module library
          </p>
          <h2 className="text-2xl font-black tracking-tight">
            Your strategy vocabulary
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Every module is a verified, compilable building block.
          </p>
        </div>

        {/* Infinite ticker — duplicated for seamless loop */}
        <div className="flex gap-3 lp-ticker w-max">
          {[...MODULES, ...MODULES].map((m, i) => (
            <div
              key={i}
              className="flex items-center gap-2 shrink-0 rounded-lg border border-border/60 bg-card/50 px-4 py-2.5 hover:border-primary/30 transition-colors"
            >
              <span className="text-xs font-medium whitespace-nowrap">
                {m.name}
              </span>
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                {m.cat}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] font-mono text-primary/70 uppercase tracking-widest mb-3">
              Features
            </p>
            <h2 className="text-3xl font-black tracking-tight">
              Built for serious traders
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              Not a template builder. Not raw AI-generated code.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-card border border-border/60 rounded-xl p-6 hover:border-primary/25 transition-colors"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 mb-4">
                  <f.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────── */}
      <section className="py-28 px-6 border-t border-border/40 relative overflow-hidden">
        {/* Background glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 100%, oklch(0.63 0.24 262 / 0.5) 0%, transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Ready to build your first EA?
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed mb-10 max-w-lg mx-auto">
            Describe any strategy. Get a compilable MT5 Expert Advisor ready for
            MetaEditor in minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              className="gap-2 px-8 h-12 text-base"
              onClick={() => openAuth("signup")}
            >
              Start building free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 text-base text-muted-foreground hover:text-foreground"
              onClick={() => openAuth("signin")}
            >
              Sign in
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-border/40 px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-muted-foreground/60">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-3.5 w-3.5 text-primary/50" />
            <span>EAbuilder — MT5 Expert Advisor Generator</span>
          </div>
          <span>2026</span>
        </div>
      </footer>
    </div>
  );
}
