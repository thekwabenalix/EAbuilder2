import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
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
        <span className="absolute left-1 top-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#2a8f86]" />
        <span className="absolute bottom-1 left-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#64d8b4]" />
        <span className="absolute left-3 top-3 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#51d9ad]" />
        <span className="absolute left-3 top-0 h-3 w-3 rotate-45 rounded-[3px] bg-[#c8f46b]" />
      </div>
      <span className="text-2xl font-semibold tracking-tight text-[var(--lp-text)]">EABuilder</span>
    </div>
  );
}

const navItems = [
  { label: "Home", to: "/" },
  { label: "Modules", to: "/modules" },
  { label: "Pricing", to: "/pricing" },
  { label: "Resources", to: "/resources" },
] as const;

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

      <section
        id="home"
        className="relative min-h-screen overflow-hidden"
        onPointerMove={handlePointerMove}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_48%,var(--lp-radial),transparent_38%),linear-gradient(135deg,var(--lp-bg),var(--lp-bg-soft))]" />
        <header className="relative z-20 mx-auto flex h-20 w-full max-w-[1920px] items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <BrandMark />

          <nav className="hidden items-center gap-10 text-sm font-medium text-[var(--lp-muted)] lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "relative transition hover:text-[var(--lp-text)] " +
                  (item.to === "/" ? "text-[var(--lp-accent)]" : "")
                }
              >
                {item.label}
                {item.to === "/" && (
                  <span className="absolute -bottom-5 left-0 h-0.5 w-full rounded-full bg-[var(--lp-accent)]" />
                )}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden h-11 items-center rounded-full border border-[var(--lp-header-action-border)] bg-[var(--lp-header-action-bg)] p-1 shadow-[0_12px_32px_var(--lp-soft-shadow)] backdrop-blur-xl sm:flex">
              <ThemeToggleIcon className="h-9 w-9 rounded-full text-[var(--lp-header-action-text)] hover:bg-[var(--lp-header-action-hover)] hover:text-[var(--lp-text)]" />
              <button
                type="button"
                className="h-9 rounded-full px-3.5 text-sm font-medium text-[var(--lp-header-action-text)] transition-colors duration-150 hover:bg-[var(--lp-header-action-hover)] hover:text-[var(--lp-text)] active:scale-[0.97]"
                onClick={() => openAuth("signin")}
              >
                Login
              </button>
            </div>
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
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden
        >
          <div className="h-full w-full opacity-25 sm:opacity-40 lg:opacity-100">
            <Suspense fallback={<div className="h-full w-full" />}>
              <LandingHeroCanvas pointer={pointer} reduced={reduced} />
            </Suspense>
          </div>
        </motion.div>

        <main className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1920px] items-center px-5 pb-8 pt-2 sm:px-8 lg:px-12 lg:pb-6 xl:px-16 2xl:px-20">
          <div className="max-w-[680px] lg:w-[42vw]">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="mb-8 inline-flex items-center gap-3 rounded-full border border-[var(--lp-accent-border)] bg-[var(--lp-pill)] px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--lp-text)] shadow-[0_18px_60px_var(--lp-soft-shadow)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lp-accent)] text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              MT5 Expert Advisor Builder
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
              className="max-w-[680px] text-[clamp(3.25rem,4.25vw,5.05rem)] font-semibold leading-[1.03] tracking-normal text-[var(--lp-text)]"
            >
              Build trading EAs
              <br />
              <span className="landing-accent-text">without writing</span>
              <br />
              MQL5<span className="text-[var(--lp-accent)]">.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.62, delay: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="mt-7 max-w-[590px] text-lg leading-8 text-[var(--lp-muted)] xl:text-xl"
            >
              Describe any strategy in plain English. EABuilder maps it to verified modules and
              generates a reliable, backtest-ready Expert Advisor.
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
                See how it works
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
