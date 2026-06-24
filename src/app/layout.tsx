// src/app/layout.tsx
import "./globals.css";
import { cookies } from "next/headers";
import NavBar from "./NavBar";
import ChatWidget from "./ChatWidget";
import ThemeProvider from "./ThemeProvider";
import AuthGate from "./AuthGate";

export const metadata = {
  title: "Skarion Tracker",
  description: "Candidate and job application tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  cookies();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AuthGate />
          <NavBar />
          <main className="page">{children}</main>
          <ChatWidget />
        </ThemeProvider>
      </body>
    </html>
  );
}
