"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  Users,
  Zap,
  Shield,
  Building2,
  Mail,
  UserPlus,
  Sparkles,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface OnboardingState {
  step: number;
  orgName: string;
  slug: string;
  website: string;
  teamSize: string;
  selectedPlan: string;
  invites: { email: string; role: string }[];
}

const defaultState: OnboardingState = {
  step: 1,
  orgName: "",
  slug: "",
  website: "",
  teamSize: "",
  selectedPlan: "professional",
  invites: [{ email: "", role: "recruiter" }],
};

const teamSizeOptions = [
  { value: "1-5", label: "1-5 employees" },
  { value: "6-20", label: "6-20 employees" },
  { value: "21-50", label: "21-50 employees" },
  { value: "50+", label: "50+ employees" },
];

const plans = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceLabel: "Free",
    features: ["Up to 3 users", "50 candidates", "5 active jobs", "Basic analytics"],
    cta: "Continue with Free",
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    priceLabel: "$29/mo",
    features: ["Up to 10 users", "200 candidates", "15 active jobs", "Email integrations"],
    cta: "Start Free Trial",
  },
  {
    id: "professional",
    name: "Professional",
    price: 79,
    priceLabel: "$79/mo",
    features: ["Up to 25 users", "1,000 candidates", "Unlimited jobs", "AI assistant", "API access"],
    cta: "Start Free Trial",
    recommended: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    priceLabel: "$199/mo",
    features: ["Unlimited users", "Unlimited candidates", "Unlimited jobs", "SSO / SAML", "Dedicated support"],
    cta: "Contact Sales",
  },
];

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "recruiter", label: "Recruiter" },
  { value: "application_engineer", label: "Application Engineer" },
];

const STORAGE_KEY = "talentos-onboarding";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [mounted, setMounted] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as OnboardingState;
        setState((current) => ({ ...current, ...parsed }));
      } catch {
        // ignore invalid stored data
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, mounted]);

  const update = (patch: Partial<OnboardingState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  const goNext = () => update({ step: Math.min(state.step + 1, 5) });
  const goBack = () => update({ step: Math.max(state.step - 1, 1) });

  const finish = () => {
    localStorage.removeItem(STORAGE_KEY);
    router.push("/candidates");
  };

  const canProceedStep2 = state.orgName.trim().length > 0 && state.teamSize !== "";
  const canProceedStep4 = state.invites.every(
    (inv) => inv.email.trim() === "" || isValidEmail(inv.email)
  );

  const addInvite = () => {
    update({ invites: [...state.invites, { email: "", role: "recruiter" }] });
  };

  const updateInvite = (index: number, patch: Partial<{ email: string; role: string }>) => {
    const next = state.invites.map((inv, i) => (i === index ? { ...inv, ...patch } : inv));
    update({ invites: next });
  };

  const removeInvite = (index: number) => {
    const next = state.invites.filter((_, i) => i !== index);
    update({ invites: next.length ? next : [{ email: "", role: "recruiter" }] });
  };

  const sendInvitesAndFinish = () => {
    const validInvites = state.invites.filter((inv) => inv.email.trim() && isValidEmail(inv.email));
    if (validInvites.length === 0) {
      finish();
      return;
    }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      finish();
    }, 1200);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-start pt-10 pb-16 px-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                s === state.step
                  ? "bg-accent text-white"
                  : s < state.step
                  ? "bg-accent-soft text-accent"
                  : "bg-border text-ink-soft"
              )}
            >
              {s < state.step ? <Check className="w-4 h-4" /> : s}
            </div>
            {s < 5 && (
              <div className={cn("w-8 h-px", s < state.step ? "bg-accent" : "bg-border")} />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div className="w-full max-w-lg bg-surface border border-border rounded-lg p-6 shadow-sm">
        {/* Step 1: Welcome */}
        {state.step === 1 && (
          <div className="text-center">
            <div className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-emerald-700 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold text-ink mb-2">Welcome to TalentOS</h1>
            <p className="text-ink-soft mb-8">
              Let&apos;s set up your recruiting workspace in 3 minutes
            </p>
            <button className="btn-primary w-full py-3 text-base" onClick={goNext}>
              Get Started <ChevronRight className="inline w-4 h-4 ml-1" />
            </button>
          </div>
        )}

        {/* Step 2: Organization Setup */}
        {state.step === 2 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-accent">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Organization Setup</h2>
                <p className="text-sm text-ink-soft">Tell us about your company</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="field-group">
                <label>Organization Name *</label>
                <input
                  value={state.orgName}
                  onChange={(e) =>
                    update({
                      orgName: e.target.value,
                      slug: slugify(e.target.value),
                    })
                  }
                  placeholder="Acme Inc."
                  autoFocus
                />
              </div>

              <div className="field-group">
                <label>Workspace Slug</label>
                <input
                  value={state.slug}
                  onChange={(e) => update({ slug: slugify(e.target.value) })}
                  placeholder="acme-inc"
                />
                <p className="text-xs text-ink-soft mt-1">
                  Used for your workspace URL: talentos.io/{state.slug || "your-slug"}
                </p>
              </div>

              <div className="field-group">
                <label>Website (optional)</label>
                <input
                  value={state.website}
                  onChange={(e) => update({ website: e.target.value })}
                  placeholder="https://acme.com"
                />
              </div>

              <div className="field-group">
                <label>Team Size *</label>
                <select
                  value={state.teamSize}
                  onChange={(e) => update({ teamSize: e.target.value })}
                >
                  <option value="">Select team size</option>
                  {teamSizeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between mt-8">
              <button className="btn" onClick={goBack}>
                Back
              </button>
              <button className="btn-primary" onClick={goNext} disabled={!canProceedStep2}>
                Next <ChevronRight className="inline w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Choose Plan */}
        {state.step === 3 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-accent">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Choose Your Plan</h2>
                <p className="text-sm text-ink-soft">Select the plan that fits your team</p>
              </div>
            </div>

            <div className="grid gap-3 mb-6">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  onClick={() => update({ selectedPlan: plan.id })}
                  className={cn(
                    "relative cursor-pointer border rounded-lg p-4 transition-all hover:shadow-sm",
                    state.selectedPlan === plan.id
                      ? "border-accent bg-accent-soft/40 ring-1 ring-accent"
                      : "border-border bg-surface"
                  )}
                >
                  {plan.recommended && (
                    <span className="absolute -top-2.5 right-3 bg-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                      Recommended
                    </span>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                          state.selectedPlan === plan.id ? "border-accent" : "border-border"
                        )}
                      >
                        {state.selectedPlan === plan.id && (
                          <div className="w-2 h-2 rounded-full bg-accent" />
                        )}
                      </div>
                      <span className="font-semibold text-ink">{plan.name}</span>
                    </div>
                    <span className="font-bold text-ink">{plan.priceLabel}</span>
                  </div>
                  <ul className="space-y-1 ml-6">
                    {plan.features.map((feat, i) => (
                      <li key={i} className="text-xs text-ink-soft flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-accent shrink-0" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button className="btn" onClick={goBack}>
                Back
              </button>
              <button className="btn-primary" onClick={goNext}>
                {plans.find((p) => p.id === state.selectedPlan)?.cta || "Next"}{" "}
                <ChevronRight className="inline w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Invite Team */}
        {state.step === 4 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-accent">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Invite Your Team</h2>
                <p className="text-sm text-ink-soft">Add colleagues to your workspace</p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              {state.invites.map((inv, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="field-group mb-0">
                      <input
                        value={inv.email}
                        onChange={(e) => updateInvite(index, { email: e.target.value })}
                        placeholder="colleague@company.com"
                        type="email"
                        className={cn(
                          inv.email && !isValidEmail(inv.email) && "border-danger"
                        )}
                      />
                      {inv.email && !isValidEmail(inv.email) && (
                        <p className="text-xs text-danger mt-1">Invalid email</p>
                      )}
                    </div>
                    <div className="field-group mb-0">
                      <select
                        value={inv.role}
                        onChange={(e) => updateInvite(index, { role: e.target.value })}
                      >
                        {roleOptions.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {state.invites.length > 1 && (
                    <button
                      className="btn-danger btn-compact mt-0 shrink-0"
                      onClick={() => removeInvite(index)}
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button className="btn btn-compact mb-8" onClick={addInvite}>
              <UserPlus className="inline w-3.5 h-3.5 mr-1" />
              Add another
            </button>

            <div className="flex items-center justify-between">
              <button className="btn" onClick={goBack}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={sendInvitesAndFinish}
                disabled={!canProceedStep4 || sending}
              >
                {sending ? "Sending invites…" : "Send Invites & Finish"}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Complete */}
        {state.step === 5 && (
          <div className="text-center">
            <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-accent-soft flex items-center justify-center text-accent">
              <Check className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Your workspace is ready!</h2>
            <p className="text-ink-soft mb-8">
              You&apos;re all set to start recruiting with TalentOS.
            </p>
            <button className="btn-primary w-full py-3 text-base" onClick={finish}>
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
