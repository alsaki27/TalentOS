// src/app/landing/page.tsx
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Hero */}
      <section className="relative overflow-hidden bg-surface border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-soft/40 via-transparent to-bg/60" />
        <div className="relative max-w-5xl mx-auto px-6 py-24 sm:py-32 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-ink mb-4">
            TalentOS
          </h1>
          <p className="text-lg sm:text-xl text-ink-soft max-w-2xl mx-auto mb-8">
            The modern candidate tracking platform built for teams that hire with precision. Organize pipelines, automate follow-ups, and make decisions with data.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="/candidates" className="inline-flex items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 transition">
              Go to Dashboard
            </a>
            <a href="/login" className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:bg-bg transition">
              Sign In
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Candidates tracked", value: "12,000+" },
            { label: "Applications processed", value: "45,000+" },
            { label: "Hiring teams", value: "300+" },
            { label: "Time to hire improved", value: "40%" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border bg-surface p-5 text-center">
              <div className="text-2xl font-bold text-ink">{stat.value}</div>
              <div className="text-xs text-ink-soft mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold text-ink text-center mb-10">Everything you need to hire better</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              title: "ATS Import",
              desc: "Import candidates from any ATS in minutes. Normalized data, no duplicates.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              ),
            },
            {
              title: "Pipeline",
              desc: "Visual pipeline stages from sourced to hired. Drag, filter, and move with confidence.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              ),
            },
            {
              title: "Analytics",
              desc: "Real-time dashboards on sourcing, conversion, and time-to-hire.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.21 15.89A10 10 0 118 2.83" /><polyline points="22 12 22 6 16 6" /><path d="M16 2v4h4" /><path d="M16 2l5 5" />
                </svg>
              ),
            },
            {
              title: "AI Assistant",
              desc: "Ask questions about candidates, generate emails, and get hiring recommendations.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a2 2 0 012 2v2a2 2 0 01-2 2 2 2 0 01-2-2V4a2 2 0 012-2z" /><path d="M12 8v8" /><path d="M5 12H2a10 10 0 0020 0h-3" /><circle cx="12" cy="18" r="2" />
                </svg>
              ),
            },
            {
              title: "Follow-ups",
              desc: "Never miss a touchpoint. Automated reminders and scheduled outreach.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              ),
            },
            {
              title: "Team Collaboration",
              desc: "Shared notes, mentions, and review workflows for structured hiring decisions.",
              icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              ),
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-surface p-6 hover:border-accent/30 transition-colors">
              <div className="mb-3 text-accent">{f.icon}</div>
              <h3 className="text-sm font-semibold text-ink mb-1">{f.title}</h3>
              <p className="text-sm text-ink-soft leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
          <h2 className="text-2xl font-bold text-ink mb-2">Ready to upgrade your hiring?</h2>
          <p className="text-ink-soft mb-6 max-w-xl mx-auto">
            Join teams that use TalentOS to move faster, stay organized, and hire the best candidates.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="/candidates" className="inline-flex items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition">
              Get Started
            </a>
            <a href="/chat" className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:bg-bg transition">
              Ask the Assistant
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-surface py-8 text-center text-xs text-ink-soft">
        © {new Date().getFullYear()} TalentOS. Built for modern recruiting teams.
      </footer>
    </div>
  );
}
