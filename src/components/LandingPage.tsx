import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <TerminalSquare className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold leading-none">MT5 AI Builder</h2>
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
          className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
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

const BRAINS = [
  {
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-950/50",
    badge: "gBias persistent",
    title: "Direction brain",
    body: "Sets market bias to Bull, Bear, or Neutral using trend and market structure logic on a higher timeframe.",
  },
  {
    icon: Crosshair,
    color: "text-blue-400",
    bg: "bg-blue-950/50",
    badge: "gSetupActive",
    title: "Setup brain",
    body: "Identifies high-probability zones such as FVG, OB, and liquidity sweeps on the setup timeframe.",
  },
  {
    icon: Zap,
    color: "text-red-400",
    bg: "bg-red-950/50",
    badge: "gExecSignal",
    title: "Execution brain",
    body: "Fires the precise entry trigger such as BOS, engulfing, or divergence on the execution timeframe.",
  },
  {
    icon: ShieldCheck,
    color: "text-amber-400",
    bg: "bg-amber-950/50",
    badge: "Deterministic",
    title: "Management brain",
    body: "Risk %, R:R ratio, SL/TP, break-even, and trailing stop. Fully deterministic and never AI-invented.",
  },
];

const FEATURES = [
  {
    icon: BarChart2,
    title: "Verified modules",
    body: "EMA, FVG, BOS, OB, Liquidity Sweep, RSI Divergence. Each one is a battle-tested inline state machine.",
  },
  {
    icon: Code2,
    title: "No raw AI MQL5",
    body: "AI only wires modules together. The assembler embeds proven logic. Hallucinations cannot ship.",
  },
  {
    icon: Download,
    title: "One-file output",
    body: "A single self-contained .mq5 file. No external indicators or DLLs to install alongside it.",
  },
  {
    icon: SlidersHorizontal,
    title: "Visual 4-Brain builder",
    body: "Drag modules onto brains visually. Set timeframes and parameters without writing any code.",
  },
  {
    icon: Play,
    title: "Instant backtest",
    body: "The desktop companion compiles the EA and launches MT5 Strategy Tester in one click.",
  },
  {
    icon: MessageSquare,
    title: "AI compile fixer",
    body: "Paste compile errors into the chat. AI patches the EA and re-emits the corrected file.",
  },
];

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
];

export function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");

  const openAuth = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} initialMode={authMode} />
      )}

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-sm tracking-tight">EAbuilder</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => openAuth("signin")}>
              Sign in
            </Button>
            <Button
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-600 text-white border-0"
              onClick={() => openAuth("signup")}
            >
              Get started free
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-24 px-6 text-center border-b border-border">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 rounded-full px-3 py-1 mb-6">
            Powered by Claude AI and verified MQL5 modules
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight tracking-tight mb-5">
            Turn your strategy into a{" "}
            <span className="text-emerald-400">compilable MT5 EA</span> in minutes
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-8 max-w-xl mx-auto">
            Describe your trading logic in plain English. EAbuilder interprets it,
            maps it to verified modules, and generates a self-contained Expert
            Advisor ready to compile and backtest.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button
              size="lg"
              className="bg-emerald-700 hover:bg-emerald-600 text-white border-0"
              onClick={() => openAuth("signup")}
            >
              Start building free
            </Button>
            <Button size="lg" variant="outline" onClick={() => openAuth("signin")}>
              Sign in
            </Button>
          </div>

          <div className="mt-12 mx-auto max-w-lg text-left bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-2 text-xs text-muted-foreground font-mono">
                strategy.mq5
              </span>
            </div>
            <pre className="px-5 py-4 text-xs font-mono leading-loose overflow-x-auto">
              <span className="text-muted-foreground">{"// Your words, verified MQL5\n"}</span>
              <span className="text-blue-400">{"void"}</span>
              <span className="text-foreground">{" OnTick() {\n"}</span>
              <span className="text-foreground">{"  DirectionBrain_Update(); "}</span>
              <span className="text-muted-foreground">{"// EMA 50/200 bias\n"}</span>
              <span className="text-foreground">{"  SetupBrain_Update();    "}</span>
              <span className="text-muted-foreground">{"// FVG detection\n"}</span>
              <span className="text-foreground">{"  ExecBrain_Update();     "}</span>
              <span className="text-muted-foreground">{"// BOS trigger\n"}</span>
              <span className="text-blue-400">{"  if"}</span>
              <span className="text-foreground">
                {" (ConfluenceGate()) ManageBrain_Execute();\n}"}
              </span>
            </pre>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-6 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs text-emerald-400 uppercase tracking-widest mb-2">
              How it works
            </p>
            <h2 className="text-2xl font-semibold">Three steps from idea to EA</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                num: "01",
                title: "Describe your strategy",
                body: "Type your logic in plain English. AI extracts timeframes, entries, filters, and risk rules automatically.",
              },
              {
                num: "02",
                title: "Review the blueprint",
                body: "AI maps your logic to the 4-Brain model using verified building blocks. No raw MQL5 code is invented.",
              },
              {
                num: "03",
                title: "Download and compile",
                body: "Get a single self-contained .mq5 file. Compile in MetaEditor and backtest in MT5 immediately.",
              },
            ].map((s) => (
              <div
                key={s.num}
                className="rounded-lg border border-border bg-card p-5"
              >
                <p className="text-xs font-mono text-emerald-400 mb-3">{s.num}</p>
                <h3 className="text-sm font-semibold mb-2">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4-Brain architecture */}
      <section className="py-20 px-6 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs text-emerald-400 uppercase tracking-widest mb-2">
              Architecture
            </p>
            <h2 className="text-2xl font-semibold">The 4-Brain model</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Every EA runs four independent brains on their own timeframes. A
              trade fires only when all active brains agree.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {BRAINS.map((b) => (
              <div
                key={b.title}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-md ${b.bg} mb-3`}
                >
                  <b.icon className={`h-4 w-4 ${b.color}`} />
                </div>
                <div className="mb-2">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${b.bg} ${b.color}`}
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
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs text-emerald-400 uppercase tracking-widest mb-2">
              Features
            </p>
            <h2 className="text-2xl font-semibold">Built for serious traders</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Not a template builder. Not raw AI-generated code.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-border bg-card p-5"
              >
                <f.icon className="h-4 w-4 text-emerald-400 mb-3" />
                <h3 className="text-sm font-semibold mb-1.5">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Module library */}
      <section className="py-20 px-6 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs text-emerald-400 uppercase tracking-widest mb-2">
              Module library
            </p>
            <h2 className="text-2xl font-semibold">Your strategy vocabulary</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Every module is a verified, compilable building block. AI only wires
              them together.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {MODULES.map((m) => (
              <div
                key={m.name}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="text-xs font-medium">{m.name}</span>
                <span className="text-[10px] text-muted-foreground">{m.cat}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-semibold mb-4">
            Ready to build your first EA?
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Describe any strategy. Get a compilable MT5 Expert Advisor in minutes.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button
              size="lg"
              className="bg-emerald-700 hover:bg-emerald-600 text-white border-0"
              onClick={() => openAuth("signup")}
            >
              Start building free
            </Button>
            <Button size="lg" variant="outline" onClick={() => openAuth("signin")}>
              Sign in
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-3.5 w-3.5" />
            <span>EAbuilder - MT5 Expert Advisor Generator</span>
          </div>
          <span>2026</span>
        </div>
      </footer>
    </div>
  );
}
