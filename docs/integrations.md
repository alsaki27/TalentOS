# Integrations: Talent OS, Microsoft Teams, and Gmail

This app now has two integration surfaces:

- Talent OS can send webhook notifications into Skarion.
- Skarion can forward those notifications into a Microsoft Teams channel.
- Admins, managers, and candidates can authorize Gmail accounts for application-related mail.

## Environment Variables

Add these to the deployed environment and to `.env.local` for local testing:

```bash
TALENT_OS_WEBHOOK_SECRET=replace-with-a-long-random-secret
TEAMS_TALENT_OS_WEBHOOK_URL=https://...

GOOGLE_CLIENT_ID=your-google-identity-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-identity-oauth-client-secret
GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.com/api/integrations/gmail/callback

GMAIL_CLIENT_ID=your-gmail-mailbox-oauth-client-id
GMAIL_CLIENT_SECRET=your-gmail-mailbox-oauth-client-secret
GMAIL_OAUTH_REDIRECT_URI=https://your-domain.com/api/integrations/gmail/callback
```

`GOOGLE_OAUTH_REDIRECT_URI` is used only by Google identity login. Gmail mailbox OAuth uses `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and optional `GMAIL_OAUTH_REDIRECT_URI`. If the Gmail redirect override is omitted, the app uses the current origin plus `/api/integrations/gmail/callback`.

## Talent OS Webhook

Endpoint:

```http
POST /api/integrations/talent-os/webhook
```

Auth:

```http
Authorization: Bearer <TALENT_OS_WEBHOOK_SECRET>
```

or:

```http
x-talent-os-secret: <TALENT_OS_WEBHOOK_SECRET>
```

Example payload:

```json
{
  "event_type": "application.reply_received",
  "external_id": "talent-os-event-123",
  "title": "Employer replied to application",
  "message": "Pearce Services replied to John Candidate's OSP Engineer application.",
  "severity": "info",
  "candidate": {
    "name": "John Candidate",
    "email": "john@example.com"
  },
  "job": {
    "title": "OSP Engineer",
    "company": "Pearce Services"
  },
  "application": {
    "id": "application-id",
    "status": "replied"
  },
  "url": "https://your-domain.com/application-queue"
}
```

Local test:

```bash
curl -X POST http://localhost:3015/api/integrations/talent-os/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TALENT_OS_WEBHOOK_SECRET" \
  -d '{"event_type":"test.notification","title":"Talent OS test","message":"Webhook reached Skarion.","severity":"success"}'
```

Behavior:

- Every accepted webhook is stored in `integration_events`.
- If `TEAMS_TALENT_OS_WEBHOOK_URL` is configured, Skarion posts a Teams MessageCard to that webhook.
- If Teams delivery fails, the event is still stored with `delivery_status = failed`.
- Admins/managers can read recent events from `GET /api/integrations/talent-os/events`.

## Microsoft Teams Setup

Create an incoming webhook URL for the target Teams channel, then set it as `TEAMS_TALENT_OS_WEBHOOK_URL`.

Microsoft's current guidance for incoming webhooks/connectors is here:
https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook

## Gmail OAuth Setup

Create a Google OAuth web application client in Google Cloud Console.

Authorized redirect URI:

```text
https://your-domain.com/api/integrations/gmail/callback
```

Local redirect URI:

```text
http://localhost:3015/api/integrations/gmail/callback
```

Scopes requested:

```text
openid
email
profile
https://www.googleapis.com/auth/gmail.modify
```

The Gmail API must be enabled in the same Google Cloud project as
`GOOGLE_CLIENT_ID`. The OAuth grant can succeed while Gmail API calls still
return HTTP 403 if the API is disabled. Public use of `gmail.modify` also
requires the Google consent-screen verification process; during testing, add
pilot candidate accounts as test users.

Google references:

- OAuth web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes

## Gmail Routes

Internal staff Gmail:

```http
GET /api/integrations/gmail/start?owner=profile&redirect=/account
GET /api/integrations/gmail/status
DELETE /api/integrations/gmail/:id
```

Shared application mailbox for admins/managers:

```http
GET /api/integrations/gmail/start?owner=shared&redirect=/account
```

Candidate Gmail through the public candidate portal:

```http
GET /api/portal/:token/gmail/start
GET /api/portal/:token/gmail/status
```

Authenticated candidate portal aliases:

```http
GET /api/portal/me/gmail/start
GET /api/portal/me/gmail/privacy
POST /api/portal/integrations/gmail/disconnect
```

Internal Gmail activity log:

```http
GET /api/gmail-communications?direction=inbox|sent|all
GET /api/gmail-communications/:messageId
```

The staff UI is `/communications/gmail`. It groups messages by Gmail thread,
supports inbox/sent/all-retained-mail views, search, candidate/category/reply
filters, full thread detail, AI metadata, workflow action items, and an Open
Gmail link. It is an internal activity log, not a candidate-facing mailbox
viewer. Personal transactions, job-alert digests, and bulk marketing are
suppressed before storage so “all mail” means all retained recruiting mail.

OAuth callback:

```http
GET /api/integrations/gmail/callback
```

## Data Storage

OAuth states are stored in `integration_oauth_states`.

Connected Gmail accounts are stored in `integration_accounts` with:

- owner type: `profile`, `candidate`, or `shared_application_mailbox`
- email
- scopes
- token expiry
- access token
- refresh token
- status

Imported messages are stored in `email_communications`. The sync stores message
metadata and body text for internal workflow processing, deduplicates by Gmail
message ID, keeps a Gmail history cursor for incremental sync, and records
unread/important/label metadata. `action_items`, `application_comments`,
`interview_schedules`, and `application_stage_history` hold the derived
workflow results. High-volume classification and interview extraction use
`gemini-2.5-flash-lite`; the existing `email_reply_draft` agent is also
flash-lite and remains human-approval-only.

Recommended next low-cost agents, to add only after measuring the current
workflow: `EmailThreadSummarizer` (flash-lite, cache summaries for long
threads), `EmailDeadlineExtractor` (flash-lite, extract reply/application
deadlines), and `EmailWorkflowReconciler` (flash-lite, review conflicting
signals before any stage change). None should send mail or downgrade an offer
without a human gate.

For production hardening, keep Google credentials out of source control, rotate webhook secrets, and use encrypted storage or a secrets vault for OAuth tokens if the deployment environment requires stricter token handling.
