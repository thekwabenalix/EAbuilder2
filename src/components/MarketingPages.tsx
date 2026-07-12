import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggleIcon } from "@/components/ThemeToggle";
import { DOWNLOADABLE_MODULE_CATEGORIES } from "@/lib/resource-module-catalog";
import {
  ArrowRight,
  CircleCheck,
  Cpu,
  Download,
  Layers3,
  Loader2,
  TerminalSquare,
  Workflow,
  X,
} from "lucide-react";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Modules", to: "/modules" },
  { label: "Pricing", to: "/pricing" },
  { label: "Resources", to: "/resources" },
] as const;

const moduleCards = [
  {
    icon: Layers3,
    title: "Verified module library",
    body: "Compose SMC, SNR, indicator, state, and execution modules without asking AI to invent trading code.",
  },
  {
    icon: Workflow,
    title: "Strategy flow builder",
    body: "Break a trader idea into ordered instances so each condition has a timeframe, role, and gate.",
  },
  {
    icon: Cpu,
    title: "Self-contained MQL5 output",
    body: "Export one EA with the selected module logic embedded, ready for MetaEditor and MT5 Strategy Tester.",
  },
] as const;

const pricingPlans = [
  {
    name: "Starter",
    price: "$0",
    note: "Explore the builder",
    features: ["Create strategy drafts", "Preview module mapping", "Download sample indicators"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Builder",
    price: "$29",
    note: "For active EA builders",
    features: [
      "AI strategy interviews",
      "Generate MT5 EAs",
      "Compile and backtest with local runner",
    ],
    cta: "Build EAs",
    featured: true,
  },
  {
    name: "Studio",
    price: "$79",
    note: "For teams and power users",
    features: ["Strategy library", "Advanced repair assistant", "Priority module requests"],
    cta: "Open studio",
    featured: false,
  },
] as const;

function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-3">
      <div className="relative h-8 w-8">
        <span className="absolute left-1 top-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#c3c7ce]" />
        <span className="absolute bottom-1 left-1 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#f0b28b]" />
        <span className="absolute left-3 top-3 h-3 w-6 rotate-[-45deg] rounded-[3px] bg-[#df8755]" />
        <span className="absolute left-3 top-0 h-3 w-3 rotate-45 rounded-[3px] bg-[#eee8e3]" />
      </div>
      <span className="text-2xl font-semibold tracking-tight text-[var(--lp-text)]">EABuilder</span>
    </Link>
  );
}

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
            <Label htmlFor="marketing-email">Email</Label>
            <Input
              id="marketing-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="marketing-password">Password</Label>
            <Input
              id="marketing-password"
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

function MarketingShell({
  active,
  children,
}: {
  active: string;
  children: (openAuth: (mode: "signin" | "signup") => void) => ReactNode;
}) {
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const openAuth = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  return (
    <div className="landing-premium min-h-screen bg-[var(--lp-bg)] text-[var(--lp-text)]">
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} initialMode={authMode} />}
      <header className="sticky top-0 z-30 border-b border-[var(--lp-outline)] bg-[var(--lp-bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-[1920px] items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <BrandMark />
          <nav className="hidden items-center gap-10 text-sm font-medium text-[var(--lp-muted)] lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "relative transition hover:text-[var(--lp-text)] " +
                  (active === item.label ? "text-[var(--lp-accent)]" : "")
                }
              >
                {item.label}
                {active === item.label && (
                  <span className="absolute -bottom-5 left-0 h-0.5 w-full rounded-full bg-[var(--lp-accent)]" />
                )}
              </Link>
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
            <button
              type="button"
              className="inline-flex h-12 items-center gap-3 rounded-full bg-[var(--lp-accent)] px-6 text-sm font-semibold text-white shadow-[0_18px_45px_var(--lp-button-shadow)] transition hover:bg-[var(--lp-accent-strong)]"
              onClick={() => openAuth("signup")}
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      {children(openAuth)}
    </div>
  );
}

export function MarketingModulesPage() {
  return (
    <MarketingShell active="Modules">
      {() => (
        <main className="px-5 py-24 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="mx-auto max-w-[1600px]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--lp-accent)]">
              Modules
            </p>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-[-0.045em] text-[var(--lp-text)] sm:text-6xl">
              Verified trading logic, ready to compose.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--lp-muted)]">
              The AI maps trader intent into verified modules, then the generator assembles the EA
              from trusted building blocks.
            </p>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {moduleCards.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="rounded-2xl border border-[var(--lp-outline)] bg-[var(--lp-outline-bg)] p-7 shadow-[0_18px_60px_var(--lp-soft-shadow)] backdrop-blur"
                >
                  <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--lp-accent-border)] bg-[var(--lp-pill)] text-[var(--lp-accent)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-semibold text-[var(--lp-text)]">{title}</h2>
                  <p className="mt-3 leading-7 text-[var(--lp-muted)]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </main>
      )}
    </MarketingShell>
  );
}

export function MarketingPricingPage() {
  return (
    <MarketingShell active="Pricing">
      {(openAuth) => (
        <main className="px-5 py-24 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="mx-auto max-w-[1600px]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--lp-accent)]">
              Pricing
            </p>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-[-0.045em] text-[var(--lp-text)] sm:text-6xl">
              Start simple. Scale when your EA workflow grows.
            </h1>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.name}
                  className={
                    "rounded-2xl border p-7 shadow-[0_18px_60px_var(--lp-soft-shadow)] backdrop-blur " +
                    (plan.featured
                      ? "border-[var(--lp-accent-border)] bg-[var(--lp-pill)]"
                      : "border-[var(--lp-outline)] bg-[var(--lp-outline-bg)]")
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-semibold text-[var(--lp-text)]">{plan.name}</h2>
                      <p className="mt-2 text-sm text-[var(--lp-muted)]">{plan.note}</p>
                    </div>
                    {plan.featured && (
                      <span className="rounded-full bg-[var(--lp-accent)] px-3 py-1 text-xs font-semibold text-white">
                        Popular
                      </span>
                    )}
                  </div>
                  <div className="mt-8 flex items-end gap-2">
                    <span className="text-5xl font-semibold tracking-[-0.04em] text-[var(--lp-text)]">
                      {plan.price}
                    </span>
                    <span className="pb-2 text-sm text-[var(--lp-muted)]">/ month</span>
                  </div>
                  <div className="mt-8 space-y-4">
                    {plan.features.map((feature) => (
                      <div
                        key={feature}
                        className="flex items-center gap-3 text-sm text-[var(--lp-text)]"
                      >
                        <CircleCheck className="h-4 w-4 text-[var(--lp-accent)]" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => openAuth("signup")}
                    className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[var(--lp-accent)] px-5 text-sm font-semibold text-white shadow-[0_18px_45px_var(--lp-button-shadow)] transition hover:bg-[var(--lp-accent-strong)]"
                  >
                    {plan.cta}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </main>
      )}
    </MarketingShell>
  );
}

export function MarketingResourcesPage() {
  return (
    <MarketingShell active="Resources">
      {(openAuth) => (
        <main className="px-5 py-24 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="mx-auto max-w-[1600px]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--lp-accent)]">
              Resources
            </p>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-[-0.045em] text-[var(--lp-text)] sm:text-6xl">
              Downloadable indicators for MT5 inspection.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--lp-muted)]">
              Log in to download indicators. Visitors can preview what is available before creating
              an account.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {DOWNLOADABLE_MODULE_CATEGORIES.map((category) => (
                <article
                  key={category.id}
                  className="rounded-2xl border border-[var(--lp-outline)] bg-[var(--lp-outline-bg)] p-6 shadow-[0_18px_60px_var(--lp-soft-shadow)] backdrop-blur"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--lp-outline)] bg-[var(--lp-pill)] text-[var(--lp-accent)]">
                      <Layers3 className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-[var(--lp-outline)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lp-muted)]">
                      {category.modules.length} MQ5
                    </span>
                  </div>
                  <h2 className="mt-6 text-lg font-semibold text-[var(--lp-text)]">
                    {category.actionLabel}
                  </h2>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--lp-accent)]">
                    {category.fullName}
                  </p>
                  <p className="mt-4 min-h-[84px] leading-7 text-[var(--lp-muted)]">
                    {category.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => openAuth("signin")}
                    className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--lp-accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--lp-accent-strong)]"
                  >
                    <Download className="h-4 w-4" />
                    Log in to select module
                  </button>
                </article>
              ))}
            </div>
          </div>
        </main>
      )}
    </MarketingShell>
  );
}
