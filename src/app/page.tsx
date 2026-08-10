// src/app/page.tsx
import { redirect } from "next/navigation";

export default function Home() {
  // One public entry point. The login surface decides whether the account is
  // staff or a candidate and routes accordingly.
  redirect("/login");
}
