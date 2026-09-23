import { redirect } from "next/navigation";

// Superseded by /inbox (Chunk F of the email-intelligence plan) - this
// page's entire functionality moved there, plus approvals, counts, and
// candidate-inbox filtering this page never had.
export default function GmailInboxRedirect() {
  redirect("/inbox");
}
