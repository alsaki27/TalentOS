"use client";

import type { ReactNode } from "react";

interface Props {
  application: any;
  resume: any;
  onBack: () => void;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ResumeSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="portal-resume-section"><h3>{title}</h3>{children}</section>;
}

function ResumePreview({ resume }: { resume: any }) {
  if (!resume) return <div className="portal-empty portal-detail-empty"><strong>Tailored resume is not ready yet.</strong><span>It will appear here when the application resume workflow completes.</span></div>;
  const content = resume.content || {};
  return (
    <div className="portal-resume-preview">
      <div className="portal-resume-heading">
        <div><div className="portal-eyebrow">Tailored resume</div><h2>{resume.title}</h2><p>{resume.version_label || "Application version"} · Updated {formatDate(resume.updated_at)}</p></div>
        <span className="portal-resume-pill portal-resume-ready">Ready</span>
      </div>
      {content.header?.fullName && <h3 className="portal-resume-name">{content.header.fullName}</h3>}
      {content.header && <p className="portal-resume-contact">{[content.header.location, content.header.email, content.header.phone].filter(Boolean).join(" · ")}</p>}
      {content.summary?.text && <ResumeSection title="Summary"><p>{content.summary.text}</p></ResumeSection>}
      {Array.isArray(content.skills) && content.skills.length > 0 && <ResumeSection title="Skills"><div className="portal-resume-skills">{content.skills.flatMap((section: any) => Array.isArray(section.skills) ? section.skills : []).map((skill: string) => <span key={skill}>{skill}</span>)}</div></ResumeSection>}
      {Array.isArray(content.experience) && content.experience.length > 0 && <ResumeSection title="Experience">{content.experience.map((experience: any) => <article className="portal-resume-entry" key={experience.id || `${experience.company}-${experience.title}`}><strong>{experience.title}</strong><span>{experience.company} · {experience.startDate || ""}{experience.endDate ? ` - ${experience.endDate}` : experience.startDate ? " - Present" : ""}</span><ul>{(experience.bullets || []).map((bullet: any, index: number) => <li key={bullet.id || index}>{bullet.text}</li>)}</ul></article>)}</ResumeSection>}
      {Array.isArray(content.education) && content.education.length > 0 && <ResumeSection title="Education"><ul className="portal-resume-plain-list">{content.education.map((education: any, index: number) => <li key={education.id || index}>{education.degree} · {education.school}{education.graduationDate ? ` (${education.graduationDate})` : ""}</li>)}</ul></ResumeSection>}
      {resume.generated_text && !content.header && <pre className="portal-resume-text">{resume.generated_text}</pre>}
    </div>
  );
}

export default function CandidatePortalApplicationDetail({ application, resume, onBack }: Props) {
  return (
    <div className="portal-shell portal-detail-shell">
      <button className="portal-back-link" onClick={onBack}>← Back to applications</button>
      <div className="portal-detail-hero">
        <div><div className="portal-eyebrow">Application details</div><h1>{application.job?.title || "Application"}</h1><p>{application.job?.company || "Company unavailable"}{application.job?.location ? ` · ${application.job.location}` : ""}</p></div>
        <span className="portal-detail-status">{application.public_status.label}</span>
      </div>
      <div className="portal-detail-grid">
        <section className="portal-card portal-detail-card"><h2>Application overview</h2><dl className="portal-detail-facts"><div><dt>Submitted</dt><dd>{formatDate(application.submitted_at)}</dd></div><div><dt>Source</dt><dd>{application.job?.source || "Unknown"}</dd></div><div><dt>Next action</dt><dd>{application.next_action || "No action scheduled"}</dd></div><div><dt>Follow-up</dt><dd>{formatDate(application.follow_up_at)}</dd></div></dl>{application.job?.source_url && <a className="portal-btn portal-btn-secondary" href={application.job.source_url} target="_blank" rel="noreferrer">View job posting</a>}</section>
        <section className="portal-card portal-detail-card"><h2>Updates</h2>{application.updates?.length ? <div className="portal-detail-updates">{application.updates.map((update: any) => <article key={update.id}><p>{update.body}</p><span>{update.author} · {formatDate(update.created_at)}</span></article>)}</div> : <p className="portal-greeting-sub">No candidate-visible updates yet.</p>}</section>
      </div>
      <section className="portal-card portal-detail-card"><h2>Progress</h2>{application.timeline?.length ? <div className="portal-timeline">{application.timeline.map((event: any) => <div className="portal-timeline-item" key={event.id}><span className="portal-timeline-dot" /><div><strong>{event.label}</strong><span>{formatDate(event.created_at)}</span></div></div>)}</div> : <p className="portal-greeting-sub">Your application timeline will appear as the team records updates.</p>}</section>
      <ResumePreview resume={resume} />
    </div>
  );
}
