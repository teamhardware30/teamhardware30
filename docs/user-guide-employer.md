# Employer Guide

## Access
An administrator must set `users.role = 'employer'` for your account.

## Post an onsite job
1. Sign in.
2. Open `/employer/jobs/new`.
3. Enter title, company, location, employment type, and description.
4. Submit the form.

## Manage jobs
- Open `/employer/jobs` to see your jobs.
- Applicants for onsite jobs appear in `/applications` and can be reviewed from `/employer/jobs/:id/applicants`.

## Notes
- Employer-created jobs use `applyMethod = onsite`.
- Descriptions are sanitized before storage and rendering.
- Employer routes are role-protected; seekers receive 403.
