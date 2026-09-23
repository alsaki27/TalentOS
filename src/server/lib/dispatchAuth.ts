/** Headers used by TalentOS server-to-server workflow dispatch calls. */
export function getWorkflowDispatchHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}
