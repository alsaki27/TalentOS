/** True only for PostgreSQL's undefined-column error naming the requested column. */
export function isMissingPostgresColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as { code?: unknown; message?: unknown };
  if (pgError.code !== "42703" || typeof pgError.message !== "string") return false;

  const message = pgError.message.toLowerCase();
  return message.includes(column.toLowerCase()) && message.includes("does not exist");
}
