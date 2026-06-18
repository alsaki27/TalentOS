# TalentOS Public REST API

The public API lives under `/api/public/*` and uses scoped API keys.

Internal app routes still use browser sessions. Public API routes use:

```http
Authorization: Bearer sk_live_...
```

or:

```http
x-api-key: sk_live_...
```

## Create API Keys

Only admins can create or revoke public API keys.

```http
GET /api/api-keys
POST /api/api-keys
DELETE /api/api-keys/:id
```

Create a key:

```json
{
  "name": "Job importer",
  "scopes": ["jobs:read", "jobs:write", "companies:write"],
  "expires_at": "2026-12-31T23:59:59.000Z"
}
```

The full key is returned once. Store it immediately.

## Scopes

Core data:

- `candidates:read`
- `candidates:write`
- `candidates:delete`
- `jobs:read`
- `jobs:write`
- `jobs:delete`
- `jobs:import`
- `jobs:shortlist`
- `applications:read`
- `applications:write`
- `applications:assign`
- `applications:status`
- `applications:comment`
- `companies:read`
- `companies:write`
- `companies:delete`
- `company_people:read`
- `company_people:write`
- `company_people:delete`

Workflow and integrations:

- `events:read`
- `events:write`
- `events:acknowledge`
- `reminders:read`
- `reminders:write`
- `analytics:read`
- `integrations:gmail:read`
- `integrations:gmail:write`
- `integrations:teams:write`
- `api_keys:manage`

## Pagination

List endpoints return:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 50
}
```

Use query params:

```http
?page=1&pageSize=50
```

## Candidates

```http
GET /api/public/candidates
POST /api/public/candidates
GET /api/public/candidates/:id
PATCH /api/public/candidates/:id
DELETE /api/public/candidates/:id
```

Filters:

```http
GET /api/public/candidates?search=osp&status=active&target_tier=osp
```

Create:

```json
{
  "name": "Jane Candidate",
  "email": "jane@example.com",
  "phone": "555-0100",
  "status": "active",
  "target_tier": "osp",
  "target_roles": "OSP Engineer, Field Engineer",
  "preferred_locations": "Florida, Remote",
  "work_authorization": "US Citizen"
}
```

## Jobs

```http
GET /api/public/jobs
POST /api/public/jobs
GET /api/public/jobs/:id
PATCH /api/public/jobs/:id
DELETE /api/public/jobs/:id
POST /api/public/jobs/import
GET /api/public/jobs/:id/shortlist
```

Filters:

```http
GET /api/public/jobs?search=fiber&source=linkedin&category=OSP&active=true
```

Create:

```json
{
  "title": "OSP Engineer",
  "company": "Example Telecom",
  "location": "Florida",
  "source": "public_api",
  "source_url": "https://example.com/jobs/123",
  "posted_at": "2026-06-18",
  "applicants_count": 14,
  "description_text": "Fiber, outside plant, permitting, field engineering."
}
```

Job creation dedupes against known posting URLs and near-duplicate title/company/posted-date/applicant-count combinations.

Bulk import:

```json
{
  "jobs": [
    {
      "title": "OSP Engineer",
      "company": "Example Telecom",
      "source_url": "https://example.com/jobs/123",
      "description_text": "Fiber and outside plant design."
    }
  ]
}
```

Requires `jobs:import`, accepts up to 500 jobs, dedupes before insert, and syncs company profiles.

Shortlist:

```http
GET /api/public/jobs/:id/shortlist?limit=25
```

Requires `jobs:shortlist`. Returns non-AI match scores and reasons.

## Applications / Tickets

```http
GET /api/public/applications
POST /api/public/applications
GET /api/public/applications/:id
PATCH /api/public/applications/:id
DELETE /api/public/applications/:id
POST /api/public/applications/:id/comments
GET /api/public/applications/:id/timeline
```

Filters:

```http
GET /api/public/applications?status=assigned&priority=urgent&assigned_to_user_id=<user_id>
```

Create an application:

```json
{
  "candidate_id": "candidate-uuid",
  "job_id": "job-uuid",
  "status": "applied",
  "notes": "Submitted through company portal."
}
```

Create an assignment ticket:

```json
{
  "candidate_id": "candidate-uuid",
  "job_id": "job-uuid",
  "status": "assigned",
  "assigned_to": "Application Engineer",
  "priority": "high",
  "assignment_note": "Use the OSP resume variant."
}
```

Assignment ticket creation requires both `applications:write` and `applications:assign`.

Status updates require `applications:write` plus `applications:status`.

Add a comment:

```json
{
  "body": "Employer replied. Waiting on interview dates.",
  "commenter_name": "Talent OS",
  "visible_to_candidate": true
}
```

## Companies

```http
GET /api/public/companies
POST /api/public/companies
GET /api/public/companies/:id
PATCH /api/public/companies/:id
DELETE /api/public/companies/:id
GET /api/public/companies/:id/jobs
GET /api/public/companies/:id/applications
GET /api/public/companies/:id/people
POST /api/public/companies/:id/people
```

Create or upsert:

```json
{
  "name": "Example Telecom",
  "website": "https://example.com",
  "linkedin_url": "https://www.linkedin.com/company/example",
  "employees_count": 250,
  "description": "Regional telecom contractor.",
  "source": "linkedin"
}
```

## Company People

```http
GET /api/public/company-people
POST /api/public/company-people
GET /api/public/company-people/:id
PATCH /api/public/company-people/:id
DELETE /api/public/company-people/:id
```

Create:

```json
{
  "company_id": "company-uuid",
  "full_name": "Alex Manager",
  "title": "Hiring Manager",
  "linkedin_url": "https://www.linkedin.com/in/example",
  "email": "alex@example.com",
  "influence_level": "hiring_manager",
  "relationship_status": "new",
  "source": "linkedin"
}
```

## Events / Notifications

```http
GET /api/public/events
POST /api/public/events
GET /api/public/events/:id
PATCH /api/public/events/:id
```

Create event:

```json
{
  "source": "talent_os",
  "event_type": "application.reply_received",
  "external_id": "evt_123",
  "title": "Employer replied",
  "message": "Pearce Services replied to an OSP Engineer application.",
  "severity": "info",
  "candidate": { "name": "Jane Candidate" },
  "job": { "title": "OSP Engineer", "company": "Pearce Services" },
  "notify_teams": true
}
```

Acknowledgement:

```json
{
  "acknowledged_by": "Manager",
  "acknowledgement_note": "Assigned to application engineer."
}
```

## Reminders / Follow-Ups

```http
GET /api/public/reminders
POST /api/public/reminders
PATCH /api/public/reminders/:applicationId
```

Filters:

```http
GET /api/public/reminders?due=today
GET /api/public/reminders?due=upcoming
```

Create or update reminder:

```json
{
  "application_id": "application-uuid",
  "follow_up_at": "2026-06-25",
  "next_action": "Follow up if no employer response."
}
```

Complete reminder:

```json
{
  "complete": true,
  "next_action": "Follow-up completed."
}
```

## Analytics

```http
GET /api/public/analytics/overview
```

Requires `analytics:read`.

Returns totals, conversion rates, status breakdown, and priority breakdown.

## Curl Example

```bash
curl http://localhost:3015/api/public/jobs?page=1&pageSize=10 \
  -H "Authorization: Bearer sk_live_your_key"
```
