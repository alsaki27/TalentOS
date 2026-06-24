# Stress Test Plan — TalentOS

## Test Groups

### Group 1: Auth & Navigation
- [ ] Login page loads
- [ ] Navigation links work (Candidates, Jobs, Companies, Interviews, Falood AI, Application Queue, Follow-ups)
- [ ] Theme toggle works
- [ ] Notifications dropdown works
- [ ] Sign out works

### Group 2: Application Queue
- [ ] Queue loads with data
- [ ] Filter by status (assigned, stacked, in_progress)
- [ ] Filter by owner
- [ ] Filter by priority
- [ ] Filter by review status
- [ ] View filter tabs (all, mine, overdue, review)
- [ ] Search
- [ ] Pagination
- [ ] Start button on stacked item → status changes, toast visible
- [ ] Start button on in_progress item → disabled
- [ ] Review button → review_status pending
- [ ] Applied button → status applied, completed_at set
- [ ] Proof upload
- [ ] Edit ticket modal
- [ ] Remove ticket
- [ ] Bulk Start
- [ ] Bulk Applied
- [ ] Bulk Reassign

### Group 3: Follow-ups
- [ ] Follow-ups page loads
- [ ] Complete follow-up
- [ ] Reschedule follow-up

### Group 4: Universal Import
- [ ] Upload JSON file
- [ ] Analyze step completes
- [ ] Review step shows mapping
- [ ] Commit step imports jobs in batches
- [ ] Duplicate filtering works
- [ ] Progress bar updates

### Group 5: Candidates
- [ ] List candidates
- [ ] Search candidates
- [ ] Create candidate
- [ ] Edit candidate
- [ ] Delete candidate
- [ ] Pagination

### Group 6: Jobs
- [ ] List jobs
- [ ] Search jobs
- [ ] Create job
- [ ] Edit job
- [ ] Delete job
- [ ] Pagination
- [ ] Company directory sync

### Group 7: Companies
- [ ] List companies
- [ ] Search companies
- [ ] Create company
- [ ] Edit company
- [ ] Delete company
- [ ] Pagination

### Group 8: Interviews
- [ ] List interviews
- [ ] Create interview
- [ ] Edit interview
- [ ] Delete interview
- [ ] Pagination

### Group 9: Notifications
- [ ] List notifications
- [ ] Mark as read
- [ ] Unread badge

### Group 10: Falood AI
- [ ] Chat interface loads
- [ ] Send message
- [ ] AI responds

### Group 11: Account
- [ ] Profile page loads
- [ ] Edit profile

## Notes
- Use browser for UI-critical flows
- Use direct API calls for CRUD endpoints
- Capture all errors and screenshots
- Test edge cases: empty states, validation errors, concurrent actions
