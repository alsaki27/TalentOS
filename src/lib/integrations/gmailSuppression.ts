export type GmailSuppressionReason = "job_alert" | "personal_transaction" | "bulk_marketing";

export function gmailSuppressionReason(message: {
  from?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  snippet?: string | null;
}): GmailSuppressionReason | null {
  const sender = (message.from || "").toLowerCase();
  const subject = (message.subject || "").toLowerCase();
  const preview = `${subject}\n${message.snippet || ""}\n${message.bodyText || ""}`.toLowerCase().slice(0, 4000);

  const jobAlertSender = /(indeed\.com|linkedin\.com|ziprecruiter\.com|glassdoor\.com|monster\.com)/i.test(sender);
  const jobAlertContent = /(job alert|jobs for you|recommended for you|you look like a great fit|jobs you may like|sponsored job|new jobs match)/i.test(preview);
  if (jobAlertSender && jobAlertContent) return "job_alert";

  const personalSender = /(doordash|ubereats|uber\.com|lyft|instacart|amazon|walmart|target|bestbuy|fedex|ups|usps|dhl|delta|united|airbnb|booking\.com|venmo|paypal|chase|bankofamerica|wellsfargo|citi|capitalone|cvs|walgreens|mychart)/i.test(sender);
  const personalContent = /(order|receipt|delivery|shipment|tracking|invoice|payment|reservation|ride|trip|verification code|one-time password|security alert|prescription|appointment)/i.test(preview);
  if (personalSender && personalContent) return "personal_transaction";

  const bulkSender = /(newsletter|marketing|promotions?|deals?|offers?)@|list-unsubscribe/i.test(sender);
  const bulkContent = /(unsubscribe|weekly newsletter|special offer|limited-time deal|promotional email)/i.test(preview);
  if (bulkSender && bulkContent) return "bulk_marketing";
  return null;
}
