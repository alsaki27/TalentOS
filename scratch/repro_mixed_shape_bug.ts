import { studioDocumentToResumeData } from "../src/lib/falood/studioDocumentToResumeData";

// Simulates exactly what src/app/api/falood/applications/route.ts's PATCH
// sync-back-to-base_resumes merge produces: canonical `header` (from
// resumifyResumeDataToExportDocument) but RAW Resumify-native customSections
// (content:string, not bullets:[]) - per the deliberate round-2 fix that
// uses body.resumeData.customSections directly instead of the lossy
// `converted.customSections`.
const mixedShapeContent = {
  header: { fullName: "Test Candidate", email: "t@example.com", phone: "555-1234", location: "City, ST" },
  summary: { text: "A summary." },
  skills: [{ title: "Tech", skills: ["React", "Node"] }],
  experience: [{ title: "Engineer", company: "Acme", bullets: [{ text: "Did a thing" }] }],
  education: [{ school: "State U", graduationDate: "2020" }],
  customSections: [
    { id: "cs-1", title: "Publications", content: "Paper One\nPaper Two", type: "bullets", visible: true, order: 7, placement: "right" }
  ],
};

const result = studioDocumentToResumeData(mixedShapeContent);
console.log("Has personalInfo key path taken?", "header" in mixedShapeContent && !("personalInfo" in mixedShapeContent));
console.log("Resulting customSections:", JSON.stringify(result.customSections, null, 2));
console.log(result.customSections.length === 0 ? "\n*** BUG CONFIRMED: customSections silently dropped ***" : "\nNot reproduced - customSections survived.");
