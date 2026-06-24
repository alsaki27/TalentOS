type ApplicationStatus =
  | "assigned"
  | "stacked"
  | "in_progress"
  | "applied"
  | "replied"
  | "interview"
  | "rejected"
  | "withdrawn"
  | "offer"
  | string;

interface AutomationInput {
  status: ApplicationStatus;
  explicitFollowUp: boolean;
  explicitNextAction: boolean;
  explicitAssignmentDue: boolean;
}

export interface ApplicationAutomation {
  follow_up_at?: string | null;
  next_action?: string | null;
  assignment_due_at?: string;
  follow_up_source?: string | null;
  follow_up_created_at?: string | null;
  follow_up_completed_at?: string | null;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function schedule(days: number, nextAction: string): ApplicationAutomation {
  return {
    follow_up_at: addDays(days),
    next_action: nextAction,
    follow_up_source: "auto_status_rule",
    follow_up_created_at: new Date().toISOString(),
    follow_up_completed_at: null,
  };
}

export function applicationAutomation(input: AutomationInput): ApplicationAutomation {
  const updates: ApplicationAutomation = {};

  if (!input.explicitAssignmentDue) {
    if (input.status === "assigned") updates.assignment_due_at = addDays(1);
    if (input.status === "stacked") updates.assignment_due_at = addDays(3);
  }

  if (input.explicitFollowUp && input.explicitNextAction) return updates;

  const reminder = (() => {
    switch (input.status) {
      case "assigned":
        return schedule(1, "Submit application or request manager review.");
      case "stacked":
        return schedule(3, "Review queued application ticket.");
      case "in_progress":
        return schedule(1, "Finish application submission.");
      case "applied":
        return schedule(7, "Follow up with employer if there is no response.");
      case "replied":
        return schedule(2, "Respond or schedule the next step.");
      case "interview":
        return schedule(1, "Send thank-you note and confirm next interview step.");
      case "offer":
        return schedule(1, "Review offer details and update candidate.");
      case "rejected":
      case "withdrawn":
        return {
          follow_up_at: null,
          next_action: "Closed - no follow-up needed.",
          follow_up_source: null,
          follow_up_created_at: null,
          follow_up_completed_at: new Date().toISOString(),
        };
      default:
        return null;
    }
  })();

  if (!reminder) return updates;
  if (!input.explicitFollowUp) {
    updates.follow_up_at = reminder.follow_up_at;
    updates.follow_up_source = reminder.follow_up_source;
    updates.follow_up_created_at = reminder.follow_up_created_at;
    updates.follow_up_completed_at = reminder.follow_up_completed_at;
  }
  if (!input.explicitNextAction) updates.next_action = reminder.next_action;
  return updates;
}
