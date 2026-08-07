export const recruitingEmailFixtures = [
  { provider: "greenhouse", subject: "Interview invitation — GIS Analyst", body: "Please choose a time for your first interview using the scheduling link.", expectedCategory: "interview_invite", relevant: true },
  { provider: "lever", subject: "Thanks for applying to GIS Technician", body: "Our recruiting team would like to speak with you about next steps.", expectedCategory: "recruiter_reply", relevant: true },
  { provider: "workday", subject: "Application status update: GIS Specialist", body: "Your application is still under consideration.", expectedCategory: "recruiter_reply", relevant: true },
  { provider: "ashby", subject: "Schedule your interview", body: "Select a time with the hiring team. The meeting will be held over Zoom.", expectedCategory: "scheduling", relevant: true },
  { provider: "zoho", subject: "Invitation to apply — GIS Data Engineer", body: "We reviewed your background and invite you to apply for this specific role.", expectedCategory: "application_invite", relevant: true },
  { provider: "indeed", subject: "You look like a great fit!", body: "Here are jobs recommended for you based on your profile.", expectedCategory: "other", relevant: false },
  { provider: "linkedin", subject: "Job alerts for you", body: "New jobs match your preferences. Sponsored recommendations included.", expectedCategory: "other", relevant: false },
  { provider: "greenhouse", subject: "Rejection notice", body: "Thank you for your time. We will not be moving forward.", expectedCategory: "rejection", relevant: true },
] as const;
