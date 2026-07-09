import { lazy, Suspense, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggleIcon } from "@/components/ThemeToggle";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";

type PointerState = { x: number; y: number };

const LandingHeroCanvas = lazy(() =>
  import("@/components/LandingHeroCanvas").then((module) => ({
    default: module.LandingHeroCanvas,
  })),
);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1115]/95 p-7 text-[#f4f2ef] shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-[#bfc3c9] transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#df8755]/30 bg-[#df8755]/15">
            <TerminalSquare className="h-4 w-4 text-[#df8755]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-none">EABuilder</h2>
            <p className="mt-1 text-xs text-[#bfc3c9]">
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
              placeholder="********"
            />
          </div>

          {error && <p className="text-xs text-red-300">{error}</p>}
          {info && <p className="text-xs text-emerald-300">{info}</p>}

          <Button
            type="submit"
            className="h-11 w-full bg-[#df8755] text-white hover:bg-[#c96f3f]"
            disabled={busy}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-[#bfc3c9] transition hover:text-white"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </motion.div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-8 w-8">
        <span className="absolute left-1 top-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#c3c7ce]" />
        <span className="absolute bottom-1 left-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#f0b28b]" />
        <span className="absolute left-3 top-3 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#df8755]" />
        <span className="absolute left-3 top-0 h-3 w-3 rotate-45 rounded-[3px] bg-[#eee8e3]" />
      </div>
      <span className="text-2xl font-semibold tracking-tight text-[var(--lp-text)]">EABuilder</span>
    </div>
  );
}

function MarketWaves({ pointer }: { pointer: PointerState }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-[var(--lp-wave-opacity)]"
      style={{ transform: `translate3d(${pointer.x * 8}px, ${pointer.y * 5}px, 0)` }}
      aria-hidden
    >
      <svg className="lp-wave-svg" viewBox="0 0 1200 760" preserveAspectRatio="none">
        {Array.from({ length: 18 }).map((_, i) => (
          <path
            key={i}
            className="lp-wave-path"
            style={{ animationDelay: `${i * -0.65}s` }}
            d={`M -80 ${430 + i * 14} C 170 ${310 + i * 9}, 290 ${570 - i * 12}, 520 ${440 + i * 10} S 850 ${320 + i * 9}, 1280 ${410 + i * 13}`}
          />
        ))}
      </svg>
    </div>
  );
}

function ChartBackdrop() {
  const candles = [
    [12, 44, 28, 68],
    [48, 58, 38, 82],
    [84, 75, 52, 97],
    [120, 88, 72, 118],
    [156, 70, 48, 91],
    [192, 54, 31, 76],
    [228, 42, 22, 61],
    [264, 63, 44, 88],
    [300, 81, 65, 105],
    [336, 95, 72, 126],
    [372, 75, 54, 98],
    [408, 60, 38, 82],
    [444, 46, 24, 67],
    [480, 64, 45, 91],
    [516, 84, 62, 108],
    [552, 98, 76, 122],
  ];

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[var(--lp-chart-opacity)]"
      viewBox="0 0 620 250"
      preserveAspectRatio="none"
      aria-hidden
    >
      <g className="stroke-[var(--lp-grid)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`v-${i}`} x1={i * 88} y1="0" x2={i * 88} y2="250" strokeDasharray="4 6" />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1="0"
            y1={35 + i * 42}
            x2="620"
            y2={35 + i * 42}
            strokeDasharray="4 6"
          />
        ))}
      </g>
      <path
        d="M0 162 C120 96 176 146 260 112 S420 86 620 124"
        fill="none"
        stroke="var(--lp-accent)"
        strokeOpacity="0.34"
        strokeWidth="1"
      />
      <g>
        {candles.map(([x, open, close, wick], i) => {
          const up = close < open;
          const top = Math.min(open, close);
          const height = Math.max(8, Math.abs(open - close));
          return (
            <g key={i} transform={`translate(${x} 55)`} opacity="0.55">
              <line
                x1="6"
                x2="6"
                y1={Math.min(top, wick - 18)}
                y2={Math.max(open, close) + 24}
                stroke="var(--lp-candle)"
                strokeWidth="1"
              />
              <rect
                x="0"
                y={top}
                width="12"
                height={height}
                rx="1.5"
                fill={up ? "var(--lp-candle-up)" : "var(--lp-candle)"}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const navItems = ["Home", "Solutions", "Modules", "Pricing", "Resources"];

const featureRow = [
  { icon: ShieldCheck, label: "Verified Modules" },
  { icon: Bot, label: "AI Strategy Builder" },
  { icon: BarChart3, label: "MT5 Ready" },
] as const;

export function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [pointer, setPointer] = useState<PointerState>({ x: 0, y: 0 });
  const prefersReducedMotion = useReducedMotion();
  const reduced = Boolean(prefersReducedMotion);

  const openAuth = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: (event.clientX - rect.left) / rect.width - 0.5,
      y: (event.clientY - rect.top) / rect.height - 0.5,
    });
  };

  return (
    <div className="landing-premium min-h-screen overflow-hidden bg-[var(--lp-bg)] text-[var(--lp-text)]">
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} initialMode={authMode} />}

      <section className="relative min-h-screen overflow-hidden" onPointerMove={handlePointerMove}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_48%,var(--lp-radial),transparent_38%),linear-gradient(135deg,var(--lp-bg),var(--lp-bg-soft))]" />
        <ChartBackdrop />
        {!reduced && <MarketWaves pointer={pointer} />}

        <header className="relative z-20 mx-auto flex h-20 w-full max-w-[1920px] items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <BrandMark />

          <nav className="hidden items-center gap-10 text-sm font-medium text-[var(--lp-muted)] lg:flex">
            {navItems.map((item) => (
              <button
                key={item}
                type="button"
                className={`relative transition hover:text-[var(--lp-text)] ${
                  item === "Home" ? "text-[var(--lp-accent)]" : ""
                }`}
              >
                {item}
                {item === "Home" && (
                  <span className="absolute -bottom-5 left-0 h-0.5 w-full rounded-full bg-[var(--lp-accent)]" />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggleIcon />
            <button
              type="button"
              className="hidden text-sm text-[var(--lp-muted)] transition hover:text-[var(--lp-text)] sm:inline-flex"
              onClick={() => openAuth("signin")}
            >
              Login
            </button>
            <motion.button
              type="button"
              whileHover={{ y: -1, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex h-12 items-center gap-3 rounded-full bg-[var(--lp-accent)] px-6 text-sm font-semibold text-white shadow-[0_18px_45px_var(--lp-button-shadow)] transition hover:bg-[var(--lp-accent-strong)]"
              onClick={() => openAuth("signup")}
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </motion.button>
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.12, ease: [0.23, 1, 0.32, 1] }}
          className="pointer-events-none absolute inset-y-0 right-0 z-0 w-full lg:left-[38%] lg:w-auto"
          aria-hidden
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_42%,var(--lp-cube-glow),transparent_46%)]" />
          <Suspense fallback={<div className="h-full w-full" />}>
            <LandingHeroCanvas pointer={pointer} reduced={reduced} />
          </Suspense>
        </motion.div>

        <main className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1920px] items-center px-5 pb-8 pt-2 sm:px-8 lg:px-12 lg:pb-6 xl:px-16 2xl:px-20">
          <div className="max-w-[820px] lg:w-[44vw] lg:min-w-[680px]">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="mb-7 inline-flex items-center gap-3 rounded-full border border-[var(--lp-accent-border)] bg-[var(--lp-pill)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--lp-text)] shadow-[0_18px_60px_var(--lp-soft-shadow)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lp-accent)] text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              AI powered / verified / no coding
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
              className="max-w-[820px] text-[clamp(3.4rem,5.15vw,5.85rem)] font-semibold leading-[0.96] tracking-[-0.052em] text-[var(--lp-text)]"
            >
              Build smarter
              <br />
              <span className="text-[var(--lp-accent)]">trading EAs</span>
              <br />
              without writing MQL5.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="mt-6 max-w-[560px] text-lg leading-8 text-[var(--lp-muted)] xl:text-xl"
            >
              Describe your strategy in plain English. We map it to verified modules and generate a
              self-contained Expert Advisor.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.24, ease: [0.23, 1, 0.32, 1] }}
              className="mt-8 flex flex-wrap items-center gap-5"
            >
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex h-16 items-center gap-5 rounded-2xl bg-[var(--lp-accent)] px-9 text-lg font-semibold text-white shadow-[0_24px_70px_var(--lp-button-shadow)] transition hover:bg-[var(--lp-accent-strong)]"
                onClick={() => openAuth("signup")}
              >
                Start Building Free
                <ArrowRight className="h-5 w-5" />
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex h-16 items-center gap-4 rounded-2xl border border-[var(--lp-outline)] bg-[var(--lp-outline-bg)] px-8 text-lg font-semibold text-[var(--lp-text)] shadow-[0_18px_60px_var(--lp-soft-shadow)] backdrop-blur transition hover:border-[var(--lp-accent-border)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lp-accent-border)] text-[var(--lp-accent)]">
                  <Play className="h-4 w-4 fill-current" />
                </span>
                Watch Demo
              </motion.button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.34, ease: [0.23, 1, 0.32, 1] }}
              className="mt-9 flex flex-wrap items-center gap-6 text-sm text-[var(--lp-text)] sm:gap-8"
            >
              {featureRow.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="h-6 w-6 text-[var(--lp-feature-icon)]" />
                  <span>{label}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </main>
      </section>
    </div>
  );
}
