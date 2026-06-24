// src/app/communications/page.tsx
// Redirect to inbox by default.

import { redirect } from "next/navigation";

export default function CommunicationsPage() {
  redirect("/communications/inbox");
}
