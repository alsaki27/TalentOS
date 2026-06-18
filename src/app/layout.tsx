// src/app/layout.tsx
import "./globals.css";
import NavBar from "./NavBar";
import ChatWidget from "./ChatWidget";

export const metadata = {
  title: "Skarion Tracker",
  description: "Candidate and job application tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        <main className="page">{children}</main>
        <ChatWidget />
      </body>
    </html>
  );
}
