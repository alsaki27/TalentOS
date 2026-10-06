import "./portal.css";
import "./portal-schedule.css";

export const metadata = {
  title: "Skarion — Candidate Portal",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-root">
      <div className="portal-bg-grid" />
      {children}
    </div>
  );
}
