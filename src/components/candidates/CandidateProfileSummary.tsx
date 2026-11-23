"use client";

import { useId, type ChangeEvent } from "react";
import styles from "./CandidateProfileOverview.module.css";

interface Profile {
  name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  target_tier: string | null;
  target_roles: string | null;
  preferred_locations: string | null;
  salary_expectation: string | null;
  work_authorization: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  visa_status: string | null;
  target_industries: string[] | null;
  verified_skills: string[] | null;
  location_preference: string | null;
  work_mode_preference: string | null;
  available_start_date: string | null;
}

export function CandidateProfileSummary({ profile, uploadingPhoto, onPhotoUpload, onEdit }: {
  profile: Profile;
  uploadingPhoto: boolean;
  onPhotoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onEdit: () => void;
}) {
  const id = useId();
  const groups = [
    { title: "Contact", fields: [["Email", profile.email], ["Phone", profile.phone]] },
    { title: "Job preferences", fields: [
      ["Target roles", profile.target_roles], ["Industries", profile.target_industries?.join(", ")],
      ["Preferred locations", profile.preferred_locations], ["Location preference", profile.location_preference],
      ["Work mode", profile.work_mode_preference], ["Salary expectation", profile.salary_expectation],
    ] },
    { title: "Work eligibility", fields: [
      ["Work authorization", profile.work_authorization], ["Visa status", profile.visa_status],
      ["Available from", profile.available_start_date ? new Date(`${profile.available_start_date.slice(0, 10)}T12:00:00`).toLocaleDateString() : null],
    ] },
  ];
  const links = [["LinkedIn", profile.linkedin_url], ["GitHub", profile.github_url], ["Portfolio", profile.portfolio_url]];
  const initials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  return <section className={styles.summary} aria-labelledby={`${id}-title`}>
    <header className={styles.summaryHeader}>
      <div className={styles.identity}>
        {profile.avatar_url ? <img className={styles.avatar} src={profile.avatar_url} alt="Candidate profile" /> :
          <span className={styles.avatar} aria-hidden="true">{initials}</span>}
        <div>
          <h2 id={`${id}-title`}>Profile summary</h2>
          <div className={styles.badges}><span className="badge">{profile.status.replaceAll("_", " ")}</span>
            {profile.target_tier && <span className="badge">{profile.target_tier.replaceAll("_", " ")}</span>}
          </div>
        </div>
      </div>
      <div className={styles.summaryActions}>
        <label className={styles.photoUpload} aria-disabled={uploadingPhoto}>
          {uploadingPhoto ? "Uploading photo…" : "Change photo"}
          <input type="file" accept="image/*" aria-label="Change profile photo" onChange={onPhotoUpload} disabled={uploadingPhoto} />
        </label>
        <button type="button" className="btn-outline btn-sm" onClick={onEdit}>Edit profile</button>
      </div>
    </header>
    <div className={styles.profileGroups}>
      {groups.map((group) => <section key={group.title} className={styles.profileGroup}>
        <h3>{group.title}</h3>
        <dl>{group.fields.map(([label, value]) => <div key={label}>
          <dt>{label}</dt><dd>{value || <span className={styles.muted}>Not provided</span>}</dd>
        </div>)}</dl>
        {group.title === "Contact" && <div className={styles.profileLinks} aria-label="Professional profiles">
          {links.map(([label, url]) => url ? <a key={label} href={url} target="_blank" rel="noreferrer">{label} ↗</a> :
            <span key={label} className={styles.muted}>{label}: not added</span>)}
        </div>}
      </section>)}
    </div>
    <div className={styles.skills}><strong>Verified skills</strong><span>{profile.verified_skills?.join(", ") || "Not provided"}</span></div>
  </section>;
}
