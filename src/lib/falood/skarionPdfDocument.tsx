// src/lib/falood/skarionPdfDocument.tsx
// Renders a ResumeDocument into the Skarion Compact Professional PDF layout (brief
// section 5/9: one page target, compact but readable, no colors/photos/icons,
// ATS-friendly headings, strong section hierarchy, bullet-heavy, no two-column layout
// unless explicitly selected — this renderer only implements the one-column default).
//
// Uses @react-pdf/renderer's built-in Helvetica font (no custom font embedding) to
// keep this dependency-light and avoid bundling font files; formatting.fontFamily is
// accepted but not honored beyond that for now.
//
// Runs entirely client-side (see clientExport.ts) - @react-pdf/renderer has a
// browser-compatible build via pdf(<Doc/>).toBlob(), so this never touches the
// Cloudflare Worker runtime at all, sidestepping the Node-only PDFKit dependency
// that made server-side rendering impossible on Workers.

import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

Font.registerHyphenationCallback((word) => [word]); // disable hyphenation — cleaner ATS text extraction

function buildStyles(formatting: ResumeFormatting) {
  const fontSize = formatting.fontSize || 10.5;
  return StyleSheet.create({
    page: {
      paddingTop: (formatting.marginTop ?? 0.5) * 72,
      paddingRight: (formatting.marginRight ?? 0.5) * 72,
      paddingBottom: (formatting.marginBottom ?? 0.5) * 72,
      paddingLeft: (formatting.marginLeft ?? 0.5) * 72,
      fontFamily: "Helvetica",
      fontSize,
      lineHeight: formatting.lineHeight || 1.15,
    },
    headerName: { fontSize: fontSize + 5, fontWeight: 700, textAlign: "center", marginBottom: 2 },
    headerContact: { fontSize: fontSize - 0.5, textAlign: "center", marginBottom: formatting.sectionSpacing ?? 8 },
    sectionTitle: {
      fontSize: fontSize + 0.5,
      fontWeight: 700,
      textTransform: "uppercase",
      borderBottom: "1pt solid #000",
      marginBottom: 3,
      marginTop: formatting.sectionSpacing ?? 8,
    },
    summaryText: { marginBottom: formatting.sectionSpacing ?? 8 },
    skillRow: { marginBottom: formatting.bulletSpacing ?? 2 },
    skillTitle: { fontWeight: 700 },
    expHeaderRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
    expTitle: { fontWeight: 700 },
    expDates: { fontStyle: "italic" },
    bullet: { flexDirection: "row", marginBottom: formatting.bulletSpacing ?? 2, paddingLeft: 10 },
    bulletMark: { width: 10 },
    bulletText: { flex: 1 },
    eduRow: { marginBottom: formatting.bulletSpacing ?? 2 },
  });
}

export function SkarionResumePdf({ content }: { content: ResumeDocument }) {
  const formatting = content.formatting;
  const styles = buildStyles(formatting);
  const contactLine = [
    content.header.location,
    content.header.phone,
    content.header.email,
    content.header.linkedin,
    content.header.github,
    content.header.portfolio,
  ].filter(Boolean).join("  |  ");

  return (
    <Document>
      <Page size={formatting.pageFormat === "a4" ? "A4" : "LETTER"} style={styles.page}>
        <Text style={styles.headerName}>{content.header.fullName}</Text>
        {contactLine && <Text style={styles.headerContact}>{contactLine}</Text>}

        {content.summary?.text && (
          <View>
            <Text style={styles.summaryText}>{content.summary.text}</Text>
          </View>
        )}

        {content.skills.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Technical Skills</Text>
            {content.skills.map((s) => (
              <Text key={s.id} style={styles.skillRow}>
                <Text style={styles.skillTitle}>{s.title}: </Text>
                {s.skills.join(", ")}
              </Text>
            ))}
          </View>
        )}

        {content.experience.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Professional Experience</Text>
            {content.experience.map((exp) => (
              <View key={exp.id} wrap={false}>
                <View style={styles.expHeaderRow}>
                  <Text style={styles.expTitle}>{exp.title} — {exp.company}{exp.location ? `, ${exp.location}` : ""}</Text>
                  <Text style={styles.expDates}>{exp.startDate} – {exp.isCurrent ? "Present" : exp.endDate ?? ""}</Text>
                </View>
                {exp.bullets.map((b) => (
                  <View key={b.id} style={styles.bullet}>
                    <Text style={styles.bulletMark}>•</Text>
                    <Text style={styles.bulletText}>{b.text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {content.projects && content.projects.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Projects</Text>
            {content.projects.map((p) => (
              <View key={p.id} wrap={false}>
                <Text style={styles.expTitle}>{p.name}{p.technologies?.length ? ` (${p.technologies.join(", ")})` : ""}</Text>
                {p.description && <Text>{p.description}</Text>}
                {p.bullets.map((b) => (
                  <View key={b.id} style={styles.bullet}>
                    <Text style={styles.bulletMark}>•</Text>
                    <Text style={styles.bulletText}>{b.text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {content.education.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Education</Text>
            {content.education.map((edu) => (
              <Text key={edu.id} style={styles.eduRow}>
                {edu.degree} — {edu.school}{edu.location ? `, ${edu.location}` : ""}{edu.graduationDate ? `  (${edu.graduationDate})` : ""}
              </Text>
            ))}
          </View>
        )}

        {content.certifications && content.certifications.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Certifications</Text>
            {content.certifications.map((c) => (
              <Text key={c.id} style={styles.eduRow}>
                {c.name}{c.issuer ? ` — ${c.issuer}` : ""}{c.date ? ` (${c.date})` : ""}
              </Text>
            ))}
          </View>
        )}

        {content.customSections?.map((section) => (
          <View key={section.id}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.bullets.map((b) => (
              <View key={b.id} style={styles.bullet}>
                <Text style={styles.bulletMark}>•</Text>
                <Text style={styles.bulletText}>{b.text}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
