"use client";

import { useState } from "react";
import {
  CreditCard,
  Check,
  Zap,
  Shield,
  Building2,
  Crown,
  ArrowUpRight,
  Settings,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { ProgressBar } from "../../../components/ProgressBar";

interface Plan {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  description: string;
  features: string[];
  cta: string;
  limits: {
    users: number;
    candidates: number;
    jobs: number;
    applications: number;
  };
}

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceLabel: "Free",
    description: "For small teams getting started",
    features: ["3 users", "50 candidates", "5 jobs", "Basic analytics", "Community support"],
    cta: "Current Plan",
    limits: { users: 3, candidates: 50, jobs: 5, applications: 100 },
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    priceLabel: "$29/mo",
    description: "For growing teams",
    features: ["10 users", "200 candidates", "15 jobs", "Email integrations", "Priority support"],
    cta: "Upgrade",
    limits: { users: 10, candidates: 200, jobs: 15, applications: 500 },
  },
  {
    id: "professional",
    name: "Professional",
    price: 79,
    priceLabel: "$79/mo",
    description: "For scaling organizations",
    features: ["25 users", "1,000 candidates", "Unlimited jobs", "AI assistant", "API access", "SSO ready"],
    cta: "Upgrade",
    limits: { users: 25, candidates: 1000, jobs: Infinity, applications: 5000 },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    priceLabel: "$199/mo",
    description: "For large organizations",
    features: ["Unlimited users", "Unlimited candidates", "Unlimited jobs", "SSO / SAML", "Dedicated support", "Custom contracts"],
    cta: "Contact Sales",
    limits: { users: Infinity, candidates: Infinity, jobs: Infinity, applications: Infinity },
  },
];

const usage = {
  users: { used: 4, max: 3 }, // over limit for demo
  candidates: { used: 38, max: 50 },
  jobs: { used: 4, max: 5 },
  applications: { used: 67, max: 100 },
};

const currentPlanId = "free";
const isTrialing = true;
const trialDaysLeft = 12;

export default function BillingPage() {
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);

  const currentPlan = plans.find((p) => p.id === currentPlanId)!;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Billing & Plans</h1>
          <p className="page-kicker">Manage your subscription and usage</p>
        </div>
        <button className="btn flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Manage Subscription
        </button>
      </div>

      {/* Current Plan Card */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center text-accent">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-ink">{currentPlan.name} Plan</h2>
                {isTrialing && (
                  <span className="badge badge-waiting">Trial</span>
                )}
              </div>
              <p className="text-sm text-ink-soft">
                {isTrialing
                  ? `${trialDaysLeft} days left in trial`
                  : "Active subscription"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentPlanId === "free" && (
              <button className="btn-primary flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4" />
                Upgrade
              </button>
            )}
            <button className="btn flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Plan Comparison */}
      <div>
        <h2 className="section-title">Plan Comparison</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isRecommended = plan.id === "professional";
            const isHovered = hoveredPlan === plan.id;

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-lg border p-5 transition-all",
                  isCurrent
                    ? "border-accent bg-accent-soft/30 ring-1 ring-accent"
                    : "border-border bg-surface",
                  isHovered && !isCurrent && "shadow-md border-ink-soft/30"
                )}
                onMouseEnter={() => setHoveredPlan(plan.id)}
                onMouseLeave={() => setHoveredPlan(null)}
              >
                {isRecommended && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                    Recommended
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-2.5 right-3 bg-ink text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Current
                  </span>
                )}

                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    {plan.id === "free" && <Building2 className="w-4 h-4 text-ink-soft" />}
                    {plan.id === "starter" && <Zap className="w-4 h-4 text-ink-soft" />}
                    {plan.id === "professional" && <Crown className="w-4 h-4 text-accent" />}
                    {plan.id === "enterprise" && <Shield className="w-4 h-4 text-ink-soft" />}
                    <h3 className="font-bold text-ink">{plan.name}</h3>
                  </div>
                  <p className="text-2xl font-bold text-ink">
                    {plan.price === 0 ? "Free" : `$${plan.price}`}
                    {plan.price > 0 && (
                      <span className="text-sm font-normal text-ink-soft">/mo</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-soft mt-1">{plan.description}</p>
                </div>

                <ul className="space-y-2 mb-5">
                  {plan.features.map((feat, i) => (
                    <li key={i} className="text-sm text-ink-soft flex items-start gap-2">
                      <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      {feat}
                    </li>
                  ))}
                </ul>

                <button
                  className={cn(
                    "w-full py-2.5 rounded-lg text-sm font-semibold transition-colors",
                    isCurrent
                      ? "bg-ink text-white cursor-default"
                      : "btn-primary"
                  )}
                  disabled={isCurrent}
                >
                  {plan.cta}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Usage Stats */}
      <div>
        <h2 className="section-title">Usage</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-ink">Team Members</span>
              <span className="text-xs text-ink-soft">
                {usage.users.used} / {usage.users.max === Infinity ? "∞" : usage.users.max}
              </span>
            </div>
            <ProgressBar
              value={usage.users.used}
              max={usage.users.max === Infinity ? usage.users.used : usage.users.max}
              showLabel
              size="sm"
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-ink">Candidates</span>
              <span className="text-xs text-ink-soft">
                {usage.candidates.used} / {usage.candidates.max === Infinity ? "∞" : usage.candidates.max}
              </span>
            </div>
            <ProgressBar
              value={usage.candidates.used}
              max={usage.candidates.max === Infinity ? usage.candidates.used : usage.candidates.max}
              showLabel
              size="sm"
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-ink">Active Jobs</span>
              <span className="text-xs text-ink-soft">
                {usage.jobs.used} / {usage.jobs.max === Infinity ? "∞" : usage.jobs.max}
              </span>
            </div>
            <ProgressBar
              value={usage.jobs.used}
              max={usage.jobs.max === Infinity ? usage.jobs.used : usage.jobs.max}
              showLabel
              size="sm"
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-ink">Applications</span>
              <span className="text-xs text-ink-soft">
                {usage.applications.used} / {usage.applications.max === Infinity ? "∞" : usage.applications.max}
              </span>
            </div>
            <ProgressBar
              value={usage.applications.used}
              max={usage.applications.max === Infinity ? usage.applications.used : usage.applications.max}
              showLabel
              size="sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
