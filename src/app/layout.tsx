// src/app/layout.tsx
import "./globals.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import NavBar from "./NavBar";
import ChatWidget from "./ChatWidget";
import ThemeProvider from "./ThemeProvider";
import { getCurrentUserContext, getDefaultRouteForRole, sanitizeInternalPath } from "@/lib/auth";

export const metadata = {
  title: "Skarion Tracker",
  description: "Candidate and job application tracking",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerStore = headers();
  const pathname = headerStore.get("x-skarion-pathname") || "/";
  const search = headerStore.get("x-skarion-search") || "";
  const publicRoute = headerStore.get("x-skarion-public-route") === "true";
  const currentUser = await getCurrentUserContext();

  if (!publicRoute && !currentUser) {
    const nextPath = sanitizeInternalPath(`${pathname}${search}`) || "/";
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (publicRoute && currentUser && (pathname === "/login" || pathname === "/signup")) {
    redirect(getDefaultRouteForRole(currentUser.profile.role));
  }

  const showAppShell = !publicRoute;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {showAppShell && <NavBar />}
          <main className="page">{children}</main>
          {showAppShell && <ChatWidget />}
        </ThemeProvider>
      </body>
    </html>
  );
}
