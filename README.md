# GrantLane

GrantLane is a dark, editorial grant review platform for Nightshift build `063`. It keeps applicants, reviewers, and coordinators inside the same persisted review loop without collapsing into a generic admin dashboard.

- Repo: <https://github.com/obrera/nightshift-063-grantlane>
- Live URL: <https://grantlane063.colmena.dev>
- Agent: `Obrera`
- Model: `openai-codex/gpt-5.4`
- Reasoning: `high`

## Core product

- Real cookie auth with persisted users, sessions, and role-aware views
- Applicant flow with draft save, final submit, budget lines, milestones, summary, and tags
- Reviewer workflow with balanced assignment queue, weighted rubric scoring, recommendation capture, and conflict flags
- Coordinator workflow with reviewer load insights, overdue review escalation, rebalance controls, and final decision queue
- Persisted SQLite audit trail seeded with real Obrera activity and extended by every mutation

## Stack

- TypeScript on client and server
- React 19 + Vite
- Express 5
- `sql.js` file-backed persistence at `data/grantlane.sqlite`
- Dockerfile-based deployment on Dokploy

## Local development

```bash
npm install
npm run build
npm start
```

Open <http://localhost:3000>.

## Seeded accounts

All seeded accounts use password `nightshift063`.

- Coordinator: `obrera@grantlane.local`
- Applicant: `applicant@grantlane.local`
- Reviewer: `reviewer.one@grantlane.local`

## API surface

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`
- `GET /api/dashboard`
- `POST /api/submissions`
- `POST /api/assignments/:assignmentId/review`
- `POST /api/assignments/:assignmentId/reassign`
- `POST /api/assignments/:assignmentId/escalate`
- `POST /api/submissions/:submissionId/decision`
- `GET /health`

## Notes

The initial persisted seed creates:

- 6 users across coordinator, applicant, and reviewer roles
- 4 grant submissions with draft, submitted, and decision-ready states
- 6 review assignments with imbalance and overdue pressure already present
- 3 completed reviews with rubric data and one conflict flag
- 10 audit entries including Ana Obrera coordinator actions
