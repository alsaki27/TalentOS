// src/app/layout.tsx
import "./globals.css";
import NavBar from "./NavBar";
import ChatWidget from "./ChatWidget";
import ThemeProvider from "./ThemeProvider";

export const metadata = {
  title: "Skarion Tracker",
  description: "Candidate and job application tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <NavBar />
          <main className="page">{children}</main>
          <ChatWidget />
        </ThemeProvider>
      </body>
    </html>
  );
}
