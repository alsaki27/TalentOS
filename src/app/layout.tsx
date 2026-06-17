// src/app/layout.tsx
import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Skarion Tracker",
  description: "Candidate and job application tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <span className="brand">Skarion Tracker</span>
          <div className="navlinks">
            <Link href="/candidates">Candidates</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/application-queue">Application Queue</Link>
            <Link href="/follow-ups">Follow-ups</Link>
            <Link href="/analytics">Analytics</Link>
          </div>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
