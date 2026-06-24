# Candidate self-login dashboard â€” design doc (not implemented)

**Status: scoped, not built.** This is a real product decision with auth/role-model
implications, written up after comparing this app's recruiting domain against the team's
separate `skarion-dev/skarion-app` (frontend) + `skarion-dev/skarion-api` (NestJS/TypeORM
backend) repos. Everything else in that comparison favored this app â€” see ROADMAP.md's
"Done" section for the full reasoning â€” but their `etl` module has one idea genuinely
worth considering here: a candidate can be linked to a real user account and log in to see
their own applications and stats (`GET /etl/my-applications`, `GET /etl/my-stats`), instead
of a magic-link token.

## What exists today

`/portal/<token>` â€” a public, no-login, read-only page. Each candidate has a
`candidates.portal_token` (a UUID, generated on row creation), and the link
`/portal/<that-uuid>` shows their submitted applications, a stats summary, and any activity
log entries explicitly flagged `visible_to_candidate`. Internal notes and pre-submission
pipeline tickets are never exposed. No password, no account, no session â€” knowledge of the
URL is the only access control.

## What their version does (for comparison, not as a spec to copy)

Trivial by comparison: `candidates.userId` optionally links to a real `users` row.
`AuthGuard`-protected endpoints (`/etl/my-applications`, `/etl/my-stats`) look up the
candidate by the logged-in user's id and return only their own data. No invite flow, no
candidate-specific UI beyond two read endpoints in the API â€” the value here is the
authentication model, not their implementation depth (which is much shallower than what
this app would need to match its existing portal feature set: activity log, application
stats, etc. all already exist and would just need re-pointing at a logged-in session
instead of a token).

## What changing this would actually require

1. **A new role or role-like concept.** Today `UserRole` is exactly
   `admin | manager | application_engineer | recruiter | reviewer` (`src/lib/auth.ts`) â€” all internal
   staff. A candidate is not staff. Either:
   - add `"candidate"` as a fifth `UserRole` and teach every existing role-gated route to
     explicitly exclude it (risk: a route that forgets to exclude it now leaks internal
     data to a candidate), or
   - keep `profiles` staff-only and add a parallel, smaller auth path specifically for
     candidates (a `candidate_sessions` table or similar, separate from `profiles`/Supabase
     Auth users) â€” more isolated, more code, but zero risk of a staff-route accidentally
     authorizing a candidate.
   The second option fits this app's existing pattern better (the portal is already a
   separate, parallel access path rather than a role on the staff account system) and is
   the recommended direction if this gets picked up.
2. **A signup/invite flow.** Candidates don't self-register today (an internal recruiter
   creates the candidate row). The natural fit: keep that, and add a "Set up portal login"
   action on the candidate profile (recruiter-triggered) that sends the candidate an email
   with a one-time link to set a password â€” turning the existing `portal_token` into a
   one-time invite rather than a permanent access link, or keeping both in parallel during
   a transition period.
3. **Session handling separate from `src/middleware.ts`.** That file's session check is
   built entirely around staff `profiles` rows. A candidate session would need its own
   cookie name and its own verification path through middleware â€” additive, not a rewrite,
   but touches the one file every route depends on, so it needs care and a fresh read
   immediately before editing, not a blind patch.
4. **Decide what happens to `/portal/<token>` during/after this.** Three real options, not
   a forced choice:
   - **Replace it** â€” every candidate must set up a login; the token link stops working.
     Cleanest long-term, but a breaking change for anyone relying on an existing shared
     link.
   - **Supplement it** â€” both exist; recruiters choose per-candidate whether to invite them
     to a real login or just hand them the token link. More flexible, more surface area to
     maintain indefinitely.
   - **Migrate gradually** â€” token links keep working for now, login is opt-in, revisit
     full replacement once adoption data exists.

## Why this wasn't just built

Three of the four items above are decisions, not implementation details â€” the role model
change has a real security tradeoff (blast radius if a route check is forgotten), and the
portal's fate is a product call, not an engineering one. Building this without those
answered would mean guessing on something expensive to reverse (auth/session
infrastructure, not a UI tweak). Flagging it here with the concrete tradeoffs is the
correct stopping point until someone makes those calls.

## Recommendation if/when this gets picked up

Parallel candidate-session path (option 2 in Â§1), invite-flow on top of the existing
`portal_token` mechanism rather than replacing it immediately (gradual migration, Â§4), and
build it as a new, isolated set of files (`src/lib/candidateAuth.ts`,
`src/app/api/candidate-auth/*`) rather than extending `src/lib/auth.ts` â€” keeps the
existing, working staff auth path completely untouched while this is built and tested.