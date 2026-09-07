# Shared Gmail mailbox

TalentOS now has one authoritative Gmail source for the inbox: the mailbox
declared by `GMAIL_SHARED_EMAIL`. The production value is
`mail.skarion@gmail.com`. Candidate-owned and staff-personal Gmail accounts are
not read by the sync worker.

## Runtime configuration

Keep OAuth client credentials in the existing secret stores. Do not put tokens,
client secrets, or refresh tokens in source control.

| Variable | Store | Purpose |
| --- | --- | --- |
| `GMAIL_SHARED_EMAIL` | Cloudflare Worker variable and local `.env.local` | Exact mailbox allowed to sync (`mail.skarion@gmail.com`) |
| `GMAIL_CLIENT_ID` | Cloudflare secret / GitHub Actions secret | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Cloudflare secret / GitHub Actions secret | Google OAuth client secret |
| `GMAIL_OAUTH_REDIRECT_URI` | Optional variable | Defaults to `https://talent.skarion.com/api/integrations/gmail/callback` in production |
| `GMAIL_PUSH_TOKEN` | Cloudflare secret / GitHub Actions secret | Pub/Sub webhook verification |
| `GMAIL_PUBSUB_TOPIC` | Cloudflare secret / GitHub Actions secret | Gmail push-watch topic |
| `AI_KEYS_ENCRYPTION_SECRET` | Cloudflare secret | Encrypts stored Gmail tokens |

`GMAIL_SHARED_EMAIL` is a non-secret allow-list value. The code fails closed if
it is missing or invalid, and the OAuth callback refuses to persist a token
unless Google identifies the authorized account as that exact address.

## Where each value comes from

- `GMAIL_SHARED_EMAIL`: type the exact mailbox address that receives the
  forwarded candidate mail. This is not a Google credential; for production it
  is `mail.skarion@gmail.com`.
- `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`: Google Cloud Console →
  **APIs & Services → Credentials → OAuth 2.0 Client IDs**. Open the Web
  application client used by TalentOS and copy its client ID and secret. Do
  not create a credential from the Gmail inbox settings.
- `GMAIL_OAUTH_REDIRECT_URI`: the TalentOS callback URL, normally
  `https://talent.skarion.com/api/integrations/gmail/callback`. Add this exact
  URL to the OAuth client's **Authorized redirect URIs**; it is not a secret.
- `GMAIL_PUSH_TOKEN`: generate a long random value yourself. It is used only
  to authenticate Gmail Pub/Sub webhook calls.
- `GMAIL_PUBSUB_TOPIC`: the full Google Cloud Pub/Sub topic name created for
  Gmail push notifications, for example
  `projects/<project-id>/topics/<topic-name>`.
- `AI_KEYS_ENCRYPTION_SECRET` and `CRON_SECRET`: generate separate long random
  values and store them as deployment secrets. They are not supplied by
  Google. `DATABASE_URL`/`NEON_DATABASE_URL` is the Neon connection string.

Never store a Gmail password, Google refresh token, or client secret in this
file or in Git. TalentOS receives the refresh token only after the one-time
OAuth consent and stores it encrypted in the database.

## Google Cloud one-time setup

1. Open Google Cloud Console and select the project that owns the TalentOS
   OAuth client.
2. Go to **APIs & Services → Library**, search for **Gmail API**, and select
   **Enable**. The current shared account cannot sync until this is enabled.
3. In **OAuth consent screen**, configure the app and add
   `mail.skarion@gmail.com` as a test user if the app is still in Testing.
   Keep the requested scopes, including `openid`, `email`, `profile`, and
   `https://www.googleapis.com/auth/gmail.modify`.
4. In **Credentials**, open the Web OAuth client and add the production
   callback URL above. Save it, then copy the client ID and secret into the
   secret stores.
5. If Gmail push notifications are enabled, create/verify the Pub/Sub topic
   and grant the Gmail service permission required by that topic. Store its
   full name in `GMAIL_PUBSUB_TOPIC` and the matching webhook token in
   `GMAIL_PUSH_TOKEN`. Google documents the required publisher identity as
   `gmail-api-push@system.gserviceaccount.com`.
6. Configure the Pub/Sub push subscription endpoint as
   `https://talent.skarion.com/api/webhooks/gmail?token=<GMAIL_PUSH_TOKEN>`.
   TalentOS also runs the five-minute polling sync, so Pub/Sub is a low-latency
   path and polling remains the recovery path.

## One-time connection

1. Sign in to TalentOS as an admin or manager and open **Inbox**.
2. Select **Connect Gmail** in the shared application Gmail panel.
3. In Google's consent screen, choose `mail.skarion@gmail.com` and grant the
   requested `gmail.modify` scope.
4. After the callback, TalentOS encrypts the access/refresh tokens in
   `integration_accounts` as the single `shared_application_mailbox` row.
5. The first bounded backfill starts automatically; the five-minute Gmail sync
   job and Pub/Sub watch continue it afterwards.

There is no safe way to connect a Gmail account using only its email address:
Google must complete this one-time OAuth consent. After that, refresh tokens
keep synchronization running without another setup step until Google revokes
access.

## Operational checks

- Inbox shows the connected shared address and last sync state.
- `/api/integrations/gmail/status` returns only the configured shared account.
- `/api/inbox/health` reports the shared mailbox rather than per-candidate
  accounts.
- `GET /api/cron/gmail-sync` uses only the shared row and never polls retired
  candidate rows.
- Candidate email privacy controls (pause/resume, retention, and delete
  history) still operate on each candidate's matched messages; they do not
  create another Gmail connection.

The old candidate/profile OAuth and send/draft implementations remain in
commented or archived files for rollback, but are not reachable from the
active UI or synchronization path.
