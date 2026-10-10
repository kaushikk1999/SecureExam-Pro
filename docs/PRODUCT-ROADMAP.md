# SecureExam Pro: next product improvements

Status updated 10 October 2026: the first six areas below now have implementations. Practice uses synthetic sample questions; learning/analytics use existing exam data; appeals preserve decision history. Google sign-in is the preferred login integration, with optional custom OIDC and Canvas support. External providers need credentials and live acceptance testing. Question import and automated retention remain proposals. See [implementation design](EXPANSION-DESIGN.md) and [integration setup](UNIVERSITY-INTEGRATIONS.md).

Original priorities: The current landing-page refresh adds scroll reveals, a changing exam-journey illustration, subtle decorative motion, an instructor/student preview, responsive layouts, and motion controls.

## Recommended order

| Priority | Addition | What it would do | UI direction |
| --- | --- | --- | --- |
| 1 | Exam readiness and practice mode | Let students rehearse device permissions, connectivity, check-in and answer saving before exam day. Give instructors a publish checklist for questions, marks, dates and entry policies. | A guided checklist with clear fixes and a safe practice attempt. |
| 2 | Instructor action center | Bring disconnected students, pending entry approvals, accommodation requests and unresolved incidents into one actionable queue. | Prioritized cards with explicit actions, timestamps and student context. |
| 3 | Student learning report | Show released feedback, rubric breakdowns and progress against learning outcomes across exams. | A personal progress dashboard with accessible charts and links to feedback. |
| 4 | Question-bank analytics | Help instructors identify unusually difficult or ambiguous questions from graded attempts. Show cohort size and avoid strong conclusions from small samples. | Question detail pages with response distributions, topic tags and revision history. |
| 5 | University account and LMS integration | Add institution SSO, roster synchronization and controlled grade export/sync. Include mapping, error handling and confirmation before grade publication. | An integration setup wizard and a visible sync history. |
| 6 | Incident review and appeals | Extend existing evidence and review notes into cases with a student explanation, reviewer decision and appeal status. Monitoring events remain signals for human review. | A chronological case view with evidence, comments and clear decision history. |
| 7 | Reviewed question import | Extract draft questions from uploaded documents, then require an instructor to review wording, correct answers and marks before saving. | A side-by-side document and editable question preview. |
| 8 | Retention and privacy controls | Turn the existing retention policy into previewable deletion jobs, with appropriate access checks, audit entries and exceptions for open cases. | Show affected record counts and dates before a destructive action. |

## Further UI improvements

- Add a course and exam calendar with upcoming deadlines and explicit timezone labels.
- Add keyboard-accessible global search for courses, exams, students and questions, respecting role permissions.
- Offer light, dark and system themes with sufficient contrast in every state.
- Improve empty, loading, offline and recovery states so users always know what to do next.
- Use short transitions for dashboard feedback. Keep active exam screens calm; avoid continuous decorative motion around answers and timers.

Start with readiness and the instructor action center: they make exam day easier for both roles and build directly on existing exam, check-in and monitoring workflows.
