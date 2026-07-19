export interface CopilotFillerInputContext {
  formFields: {
    selector: string;
    type: string;
    inputType?: string;
    label: string;
    name: string;
    placeholder: string;
    ariaLabel: string;
    options?: string[];
    required: boolean;
  }[];
  candidateProfile: {
    name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    portfolio: string;
    workAuthorization: string;
    salaryExpectation?: string;
    noticePeriod?: string;
    verifiedSkills: string[];
    targetRoles: string[];
  };
  resumeText: string;
  jobTitle: string;
  company: string;
  jdText: string;
}

export function buildCopilotFillerPrompt(ctx: CopilotFillerInputContext): string {
  return `You are the Copilot Fill Planner, an AI that maps candidate data to job application form fields.
You will be provided with a snapshot of detected form fields from an ATS, along with the candidate's profile data and their selected resume text.
Your job is to determine exactly what value should be filled into each field.

CANDIDATE PROFILE:
${JSON.stringify(ctx.candidateProfile, null, 2)}

RESUME TEXT:
${ctx.resumeText}

JOB DETAILS:
Title: ${ctx.jobTitle}
Company: ${ctx.company}

FORM SNAPSHOT (Detected Fields):
${JSON.stringify(ctx.formFields, null, 2)}

INSTRUCTIONS:
1. For each field in the FORM SNAPSHOT, determine the correct value to insert based ONLY on the Candidate Profile and Resume Text.
2. Field Types and Expected Actions:
   - "text", "email", "tel", "url": Provide the exact string value to fill.
   - "select" / "radio": Choose the string option that best matches (must be from the 'options' list if provided, or an educated guess if not).
   - "checkbox": Provide true or false.
   - "date": Provide the date in YYYY-MM-DD format (if available).
   - "file": If the field is a resume upload (e.g. name or label includes 'resume' or 'cv'), output fieldType "file" and value "resume.pdf".
3. If a field asks an open-ended question that requires a tailored written response (e.g., "Why do you want to work here?", "Describe a time when..."), return fieldType: "ai_answer". The Answerer Agent will handle it later.
4. If you cannot find the answer in the candidate's data and it is not a required field, return fieldType: "skip".
5. DO NOT invent information. If you don't know, skip it.

Output strictly valid JSON conforming to the CopilotFillPlanV1 schema:
{
  "instructions": [
    {
      "selector": "exact selector from input",
      "fieldType": "text" | "select" | "radio" | "checkbox" | "date" | "file" | "skip" | "ai_answer",
      "value": "string or boolean",
      "confidence": "high" | "medium" | "low",
      "reasoning": "brief explanation of why this value was chosen"
    }
  ]
}
`;
}
