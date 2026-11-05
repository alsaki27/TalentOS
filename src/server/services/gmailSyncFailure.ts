export type GmailSyncFailure = {
  kind: "reauthorize" | "refresh_access_token" | "retry_sync";
  storedCode: string;
  userMessage: string;
};

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

export function classifyGmailSyncFailure(error: unknown): GmailSyncFailure {
  const message = getErrorMessage(error);

  if (message === "invalid_grant" || message === "no_refresh_token") {
    return {
      kind: "reauthorize",
      storedCode: `reauth_required:${message}`,
      userMessage: "Google authorization expired or was revoked. Reconnect the shared mailbox.",
    };
  }

  if (/\(\s*401\s*\)/.test(message)) {
    return {
      kind: "refresh_access_token",
      storedCode: "access_token_refresh_pending",
      userMessage: "Google rejected the access token. It will be refreshed automatically.",
    };
  }

  return {
    kind: "retry_sync",
    storedCode: "provider_retry_pending",
    userMessage: "Gmail sync failed temporarily. It will retry automatically.",
  };
}
