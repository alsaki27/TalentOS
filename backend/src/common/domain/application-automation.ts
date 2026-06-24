export interface ApplicationAutomationInput {
  status: string;
  explicitFollowUp: boolean;
  explicitNextAction: boolean;
  explicitAssignmentDue: boolean;
}

export interface ApplicationAutomationResult {
  followUpAt?: string | null;
  nextAction?: string | null;
  assignmentDueAt?: string;
  followUpSource?: string | null;
  followUpCreatedAt?: Date | null;
  followUpCompletedAt?: Date | null;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function schedule(days: number, nextAction: string): ApplicationAutomationResult {
  return {
    followUpAt: addDays(days),
    nextAction,
    followUpSource: "auto_status_rule",
    followUpCreatedAt: new Date(),
    followUpCompletedAt: null,
  };
}

export function applicationAutomation(input: ApplicationAutomationInput): ApplicationAutomationResult {
  const updates: ApplicationAutomationResult = {};
  if (!input.explicitAssignmentDue) {
    if (input.status === "assigned") updates.assignmentDueAt = addDays(1);
    if (input.status === "stacked") updates.assignmentDueAt = addDays(3);
  }

  if (input.explicitFollowUp && input.explicitNextAction) return updates;

  const reminder = (() => {
    switch (input.status) {
      case "assigned": return schedule(1, "Submit application or request manager review.");
      case "stacked": return schedule(3, "Review queued application ticket.");
      case "in_progress": return schedule(1, "Finish application submission.");
      case "applied": return schedule(7, "Follow up with employer if there is no response.");
      case "replied": return schedule(2, "Respond or schedule the next step.");
      case "interview": return schedule(1, "Send thank-you note and confirm next interview step.");
      case "offer": return schedule(1, "Review offer details and update candidate.");
      case "rejected":
      case "withdrawn":
        return {
          followUpAt: null,
          nextAction: "Closed - no follow-up needed.",
          followUpSource: null,
          followUpCreatedAt: null,
          followUpCompletedAt: new Date(),
        };
      default:
        return null;
    }
  })();

  if (!reminder) return updates;
  if (!input.explicitFollowUp) {
    updates.followUpAt = reminder.followUpAt;
    updates.followUpSource = reminder.followUpSource;
    updates.followUpCreatedAt = reminder.followUpCreatedAt;
    updates.followUpCompletedAt = reminder.followUpCompletedAt;
  }
  if (!input.explicitNextAction) updates.nextAction = reminder.nextAction;
  return updates;
}
