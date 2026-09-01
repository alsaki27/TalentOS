import type { CSSProperties } from "react";

export const metadata = {
  title: "Privacy Policy — TalentOS",
};

export default function PrivacyPolicyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0b0c10", color: "#e6e8ec", padding: "48px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", lineHeight: 1.65, fontSize: 15 }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ color: "#9aa1ac", marginBottom: 32 }}>Last updated: September 1, 2026</p>

        <p>
          TalentOS ("TalentOS", "we", "us") is a recruiting operations platform operated by Skarion,
          used internally to manage candidate applications, resume tailoring, and recruiter-candidate
          communication. This policy explains what information we collect, how we use it, and the
          controls available to candidates and staff.
        </p>

        <h2 style={sectionH2}>Information we collect</h2>
        <ul style={list}>
          <li>Candidate profile information you or a recruiter provides: name, contact details, resumes, and job application history.</li>
          <li>Application and hiring-pipeline data: job matches, application status, interview scheduling, and recruiter notes.</li>
          <li>
            <strong>Gmail data (optional, opt-in only):</strong> if a candidate chooses to connect their Gmail account,
            TalentOS reads messages related to their job applications (subject, sender, body, and thread metadata) in
            order to detect recruiter replies, interview invitations, and offers, and to keep the candidate's
            application timeline up to date. Connecting Gmail is never required to use TalentOS.
          </li>
        </ul>

        <h2 style={sectionH2}>How we use Gmail data specifically</h2>
        <ul style={list}>
          <li>We read application-related email to automatically match it to the correct job application and update its status.</li>
          <li>We apply Gmail labels (e.g. "TalentOS/Interview", "TalentOS/Offer") and stars to relevant messages so they're easy to find in the candidate's own inbox. We do not alter message content.</li>
          <li>We never send email on a candidate's behalf automatically. Email is only ever sent from a connected account when a staff member explicitly composes and sends a reply through the TalentOS inbox tool.</li>
          <li>We do not permanently delete any email or mailbox data.</li>
          <li>We do not sell Gmail data, or any other personal data, to third parties.</li>
        </ul>

        <h2 style={sectionH2}>Candidate controls</h2>
        <ul style={list}>
          <li>Gmail connection is opt-in and can be disconnected at any time from the candidate portal.</li>
          <li>Candidates can pause automated email review at any time without disconnecting Gmail entirely.</li>
          <li>Candidates can delete previously-imported email history from their portal, on demand.</li>
          <li>Imported email is retained for a candidate-configurable period (365 days by default) and automatically purged after that window.</li>
        </ul>

        <h2 style={sectionH2}>Google user data &amp; Limited Use</h2>
        <p>
          TalentOS's use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: "#8ab4ff" }}>
            Google API Services User Data Policy
          </a>, including the Limited Use requirements. Gmail data is used solely to provide and improve
          the candidate-facing recruiting features described above, is never used for advertising, and is
          never shared with third parties for unrelated purposes.
        </p>

        <h2 style={sectionH2}>Data retention &amp; deletion</h2>
        <p>
          Candidates may request full deletion of their account and associated data, including any imported
          Gmail history, at any time by contacting us using the details below. Imported email history is also
          automatically deleted after the retention window described above.
        </p>

        <h2 style={sectionH2}>Contact</h2>
        <p>
          Questions about this policy or your data can be sent to{" "}
          <a href="mailto:inuberryglobal@gmail.com" style={{ color: "#8ab4ff" }}>inuberryglobal@gmail.com</a>.
        </p>
      </div>
    </div>
  );
}

const sectionH2: CSSProperties = { fontSize: 19, marginTop: 32, marginBottom: 10 };
const list: CSSProperties = { paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 };
