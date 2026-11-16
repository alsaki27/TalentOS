import "./portal.css";
import "./portal-schedule.css";
import PortalOnboardingGate from "./PortalOnboardingGate";
import { PortalShell } from "./PortalShell";

export const metadata = {
  title: "Skarion — Candidate Portal",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-root">
      <div className="portal-bg-grid" />
      <PortalOnboardingGate>
        <PortalShell>{children}</PortalShell>
      </PortalOnboardingGate>
    </div>
  );
}
