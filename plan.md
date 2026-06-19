# TalentOS v2 — Feature Build Plan: Analytics, Interviews, Email Engine

## Research Summary (from competitor analysis)

### Greenhouse (Market Leader, 93% 4-5★ rating)
- Structured hiring with customizable scorecards per role
- DEI reporting + diversity dashboards
- Source effectiveness tracking (LinkedIn, CSV, ATS, career page)
- Time-to-hire, time-to-fill, offer acceptance rate
- Interview kits with role-specific questions
- Interviewer calibration + feedback consistency reports
- Premium pricing, complex setup

### Lever (ATS+CRM, 400+ integrations)
- Unified pipeline + CRM nurture
- Drip campaigns with multi-touch sequences
- Email engagement tracking (opens, clicks, replies)
- Candidate self-scheduling
- Structured feedback forms with consensus tools
- 71% of businesses prioritize CRM in ATS

### Workday (Enterprise)
- VIBE Central diversity dashboard
- Real-time workforce analytics
- Benchmarking against peers
- Pipeline bottleneck identification
- Drill-down by department/location

### Key User Pain Points
1. Manual email follow-ups consume 80% of recruiter time
2. No visibility into where candidates drop off in the funnel
3. Inconsistent interview feedback across interviewers
4. No source attribution for best-performing channels
5. Diversity data is hard to track and report
6. Coordinating interview panels is a full-time job

## Feature 2: Advanced Analytics Dashboard

### SQL Foundation
New `analytics` table (materialized or computed on-the-fly):
- `application_funnel` — counts per stage per time period
- `time_to_fill` — days from job creation to hire per job
- `source_effectiveness` — applications per source, conversion rate per source
- `diversity_metrics` — gender, ethnicity, geography breakdowns
- `recruiter_performance` — candidates sourced, applications processed, offers made

### Frontend Pages
1. `/analytics` — Main dashboard with:
   - Hiring funnel (6 stages: Sourced → Applied → Screened → Interviewed → Offered → Hired)
   - Funnel conversion rates per stage
   - Time-to-fill by role, department, recruiter
   - Source effectiveness chart (pie + bar)
   - Diversity pie charts + breakdown tables
   - Recruiter leaderboard + performance cards
   - Date range filter (7d, 30d, 90d, YTD, custom)
   - Export to CSV

2. `/analytics/pipeline` — Detailed pipeline view:
   - Kanban-style funnel with stage counts
   - Bottleneck highlighting (stage with lowest conversion)
   - Candidate velocity chart (days per stage)
   - Drop-off reasons (if captured)

3. `/analytics/diversity` — DEI reporting:
   - Gender breakdown by role, department, stage
   - Ethnicity representation
   - Geography distribution
   - Year-over-year trends
   - Comparison to industry benchmarks

4. `/analytics/recruiters` — Team performance:
   - Individual recruiter cards
   - Metrics: candidates sourced, applications reviewed, interviews scheduled, offers extended, hires made, avg time-to-fill
   - Leaderboard table

### Backend (Next.js API routes)
- `GET /api/analytics/funnel` — stage counts with conversion rates
- `GET /api/analytics/time-to-fill` — aggregated by role/department/recruiter
- `GET /api/analytics/sources` — source effectiveness breakdown
- `GET /api/analytics/diversity` — diversity metrics
- `GET /api/analytics/recruiters` — recruiter performance
- All routes accept `dateFrom`, `dateTo`, `jobId`, `department` filters

## Feature 3: Interview Management

### Database Schema (Supabase SQL)
```sql
-- interview_schedules
CREATE TABLE interview_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id),
  round_number integer NOT NULL DEFAULT 1,
  round_name text NOT NULL, -- "Phone Screen", "Technical Interview", "Culture Fit"
  scheduled_at timestamptz,
  duration_minutes integer DEFAULT 60,
  status text DEFAULT 'scheduled', -- scheduled | completed | cancelled | no_show
  location text, -- "Zoom", "Google Meet", "In-Person"
  meeting_link text,
  created_by text NOT NULL, -- clerk user id
  created_at timestamptz DEFAULT now()
);

-- interview_panel_members
CREATE TABLE interview_panel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  interviewer_id text NOT NULL, -- clerk user id
  role text DEFAULT 'interviewer', -- interviewer | shadow | observer
  status text DEFAULT 'pending', -- pending | confirmed | declined
  feedback_submitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- interview_scorecards
CREATE TABLE interview_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  panel_member_id uuid NOT NULL REFERENCES interview_panel_members(id),
  overall_rating integer, -- 1-5
  recommendation text, -- strong_hire | hire | lean_hire | no_hire | strong_no_hire
  -- competencies stored as JSON for flexibility
  competencies jsonb DEFAULT '[]', -- [{"name":"Communication","rating":4,"notes":"..."}]
  overall_notes text,
  verdict_notes text,
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- interview_scorecard_templates
CREATE TABLE interview_scorecard_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text, -- optional for multi-tenancy
  name text NOT NULL,
  role_type text, -- "engineering", "sales", "general"
  competencies text[] DEFAULT '{}', -- ["Communication", "Technical Skills", "Problem Solving", "Culture Fit"]
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

### Frontend Pages
1. `/interviews` — Interview calendar + list:
   - Calendar view (month/week/day) with scheduled interviews
   - List view with filters: upcoming, today, past, no-show
   - Cards showing: candidate name, job title, round, time, interviewers, status
   - Quick actions: reschedule, cancel, send reminder

2. `/interviews/:id` — Interview detail page:
   - Candidate info card
   - Job info card
   - Interview panel (interviewer avatars, roles, confirmation status)
   - Scorecard form (if not yet submitted)
   - Submitted scorecards (read-only after submission)
   - Consensus view (aggregate scores across all interviewers)
   - Notes/comment thread
   - Action buttons: advance to next stage, reject, send offer

3. `/interviews/scorecards` — Scorecard templates:
   - List of templates
   - Create/edit template with competency builder
   - Set default template per role type

4. `/interviews/schedule` — Scheduling modal/page:
   - Candidate selection (search from applications)
   - Round selection (dropdown from template or custom)
   - Date/time picker
   - Duration selector
   - Panel builder (add interviewers, set roles)
   - Meeting link input (or auto-generate with Google Calendar/Outlook integration)
   - Send calendar invites toggle

### Backend API Routes
- `POST /api/interviews` — create schedule
- `GET /api/interviews` — list with pagination + filters
- `GET /api/interviews/:id` — get detail with panel + scorecards
- `PATCH /api/interviews/:id` — reschedule, cancel, update
- `POST /api/interviews/:id/panel` — add panel member
- `DELETE /api/interviews/:id/panel/:memberId` — remove panel member
- `POST /api/interviews/:id/scorecard` — submit scorecard
- `GET /api/interviews/:id/scorecard` — get consensus scorecard
- `GET /api/scorecard-templates` — list templates
- `POST /api/scorecard-templates` — create template

## Feature 4: Email & Communication Engine

### Database Schema (Supabase SQL)
```sql
-- email_templates
CREATE TABLE email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text,
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL, -- HTML body with merge tags {{candidate_name}}, {{job_title}}, etc.
  category text DEFAULT 'general', -- outreach | rejection | offer | screening | follow_up
  is_default boolean DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- email_sequences
CREATE TABLE email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text,
  name text NOT NULL,
  description text,
  trigger_event text, -- application_created | stage_change | interview_scheduled | no_activity_7d
  is_active boolean DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- email_sequence_steps
CREATE TABLE email_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  template_id uuid NOT NULL REFERENCES email_templates(id),
  delay_hours integer NOT NULL DEFAULT 24, -- hours after trigger or previous step
  send_time text, -- optional: "9:00 AM" for time-of-day preference
  condition text, -- optional: "if_not_replied", "if_stage_is_screening"
  created_at timestamptz DEFAULT now()
);

-- email_logs
CREATE TABLE email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  template_id uuid REFERENCES email_templates(id),
  sequence_id uuid REFERENCES email_sequences(id),
  step_number integer,
  subject text NOT NULL,
  body text NOT NULL,
  status text DEFAULT 'sent', -- sent | delivered | opened | clicked | bounced | failed | replied
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  error_message text,
  sent_by text, -- clerk user id or 'system' for automation
  sent_at timestamptz DEFAULT now()
);

-- candidate_messages
CREATE TABLE candidate_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  direction text NOT NULL, -- inbound | outbound
  channel text NOT NULL, -- email | sms | whatsapp | in_app
  subject text,
  body text NOT NULL,
  sender_id text, -- clerk user id or null for candidate
  sender_name text,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

### Frontend Pages
1. `/communications/templates` — Email Template Library:
   - Grid/list of templates with preview
   - Categories: Outreach, Rejection, Offer, Screening, Follow-up, Custom
   - Template editor with rich text (or simple HTML) + merge tag picker
   - Live preview with sample candidate data
   - Duplicate, delete, set default

2. `/communications/sequences` — Drip Campaign Builder:
   - List of sequences with status (active/paused)
   - Sequence builder (drag-and-drop steps):
     - Step 1: Template + delay (e.g., 0 hours = immediate)
     - Step 2: Template + delay (e.g., 72 hours)
     - Step 3: Template + delay (e.g., 168 hours)
   - Trigger conditions: when application created, stage changed, no activity for X days
   - A/B test variant support (optional)
   - Engagement metrics per sequence: sent, opened, clicked, replied

3. `/communications/logs` — Communication Log:
   - Timeline view of all emails sent to a candidate
   - Status indicators: sent, delivered, opened, clicked, replied
   - Search by candidate, template, date range
   - Filter by status, channel, sequence

4. `/communications/inbox` — Two-way Message Center:
   - Gmail/Outlook-style inbox with candidate threads
   - Left sidebar: candidate list with unread counts
   - Main pane: message thread with candidate
   - Compose with template picker + merge tags
   - Reply detection (when candidate replies, it appears here)

5. `/candidates/:id/messages` — Candidate Message Thread:
   - Inline on candidate detail page
   - Shows all communication history
   - Quick send with template picker
   - SMS/WhatsApp toggle (if integrated)

### Backend API Routes
- `GET /api/email-templates` — list templates
- `POST /api/email-templates` — create template
- `PATCH /api/email-templates/:id` — update template
- `DELETE /api/email-templates/:id` — delete template
- `GET /api/email-sequences` — list sequences
- `POST /api/email-sequences` — create sequence
- `POST /api/email-sequences/:id/trigger` — manually trigger for a candidate
- `GET /api/email-logs` — list logs with pagination + filters
- `POST /api/email-logs` — log an email (called by email service)
- `POST /api/email-logs/:id/track` — track open/click (pixel tracking)
- `GET /api/candidate-messages/:candidateId` — get message thread
- `POST /api/candidate-messages` — send message to candidate
- `POST /api/email/send` — send email immediately (uses template + merge tags)

### Email Service
- Create `src/lib/emailService.ts`:
  - `sendEmail(candidateId, templateId, mergeData)` — sends via Resend/SendGrid
  - `sendSequence(candidateId, sequenceId, triggerEvent)` — triggers drip sequence
  - `trackOpen(logId)` — returns tracking pixel
  - `trackClick(logId, url)` — redirects with click tracking
- Background job: `src/lib/emailQueue.ts` — processes scheduled emails (run every 15 min)
- Cron job: processes pending sequence steps that are due

## SQL Migrations to Create
All SQL goes in `sql/03_analytics_interviews_email.sql`:
1. interview_schedules table
2. interview_panel_members table
3. interview_scorecards table
4. interview_scorecard_templates table
5. email_templates table
6. email_sequences table
7. email_sequence_steps table
8. email_logs table
9. candidate_messages table
10. Analytics helper functions (if needed)

## Build Order
### Stage 1: Database + SQL (1 agent)
- Create all SQL migration files
- Add to `sql/03_analytics_interviews_email.sql`

### Stage 2: Analytics Dashboard (1 agent)
- Backend API routes for analytics
- Frontend analytics page with charts
- Uses existing chart library or simple CSS bar charts

### Stage 3: Interview Management (1 agent)
- SQL schema (already done in Stage 1)
- Backend API routes for interviews
- Frontend interview pages (calendar, detail, scorecard)

### Stage 4: Email Engine (1 agent)
- SQL schema (already done in Stage 1)
- Backend API routes for email
- Frontend template library, sequence builder, message center
- Email service with Resend integration (or mock for now)

### Stage 5: Navigation + Integration (1 agent)
- Add analytics, interviews, communications to NavBar
- Add links to Sidebar/dashboard cards
- Ensure all new routes are protected by auth
- Test cross-page navigation

## Design Notes
- All charts use CSS-based simple charts (no heavy library needed) or lightweight SVG
- Color palette uses existing CSS variables (`--accent`, `--ink`, `--warn`, `--danger`, etc.)
- Dark mode compatible throughout
- Mobile responsive for all new pages
- Follow existing Next.js App Router patterns
- All API routes use `cache: "no-store"` and existing auth middleware
