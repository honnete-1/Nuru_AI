# Test report

Environment: Windows 10, Python 3.12.0, Django 5.2.18, Node 22 (syntax checks only), Chromium via
Playwright. Date: 2026-10-30. **No AI provider key was available.** Nothing in this report is
evidence of live-model quality; every AI path below used a mocked provider or demo mode.

## 0. Baseline before changes
`python -m pytest -q` on the unmodified project: **59 passed**.

## 1. Automated tests (run): `python -m pytest -q` → **80 passed**

| File | Tests | What it proves |
|---|---|---|
| `tests/test_study_together.py` | 21 (new) | The Study Together redesign (below) |
| `tests/test_acceptance.py` | 40 | The earlier 14 acceptance areas. Two were updated for the redesign: test 2 now checks labelled navigation and that no furniture acts as a control; test 10 now expects the new "Prepare a question for my lecturer" option |
| `tests/test_workflows.py` | 18 | The original project's tests, unchanged |
| `tests/test_migrations.py` | 1 | An old (0001) database upgrades through 0004 with every record intact; new fields start empty |

New coverage in `test_study_together.py` (mocked provider where AI is involved):
- **Terminology**: the old room labels and implementation copy are absent from every template and JS module; the new onboarding sentence, "Start studying with Nuru", "View assignment steps" and "Back to Today" are present.
- **Today**: the question, the six actions in three groups, and the four information cards exist; a new account gets honest empty state (no invented assignments, progress or deadlines).
- **Help me here**: a step context shares only that assignment and step; a step from another assignment or another student's assignment returns 404; live payloads never include grades or check-ins; proposals create nothing until approved; a selected passage is cited and owner-checked; plan help explains infeasible work without saving sessions or moving deadlines; "I need to talk" sends no records and asks how the student feels.
- **Continuity**: the resume pointer is validated and drops finished work; working notes save, export and reject other students; focus logs link to their step once and reject a mismatched step; avatar choices are validated.
- **Revision**: recall question first with no note passages revealed; demo answers are self-checks, never "checked"; a related question differs; the summary counts questions, checked answers, self-checks and self-reported confidence; the review date falls before the assessment; the revision keepsake is granted once; finished sessions close; live on-track answers count until flagged; provider failure is a labelled fallback; other students get 404; foreign materials and bad dates are rejected.
- **Grades**: the response follows the stated feeling (92% disappointed, 48% proud, 70% mixed), offers pause/talk/question before planning, never grants rewards; a lecturer-question chat sends only the fields the student ticked.

Also run: `manage.py check` (no issues), `manage.py check --deploy` with production-style env (no issues),
`makemigrations --check` (no changes), `node --check` on every JS module (no errors).

## 2. Real-browser checks (run): `tools/browser_check.py` → **52 passed, 0 failed**
Against `runserver` with a throwaway database outside the project. Chromium at 1440×900, 1280×800 with
reduced motion, and 390×844 (mobile, touch):
onboarding introduces Nuru and ends with "Start studying with Nuru"; Today shows the question and six
labelled actions; no furniture controls; Tab reaches the navigation and Enter opens Assignments & Study
Plan; an assignment is created, broken into editable steps and opened in Study Together with its
checklist and current step; Help me here focuses the composer, shows what is shared, and returns a
mode-labelled reply without losing the step; working notes autosave; focus runs inline, persists as a
top-bar pill on Today, returns to the same step, saves once and links to the step; the companion collapses
with Help me here still visible; a chat draft survives navigation and a reload; plan preview changes nothing
until approved; revision starts with a question, gives feedback after the attempt, and ends with an honest
summary; a disappointing 92 is met with choices; reduced motion stops scene animation; ten mobile views
have no horizontal scroll; the bottom navigation is at the bottom with ≥44 px targets; More reaches Talk to
Nuru, Grades and Progress; the mobile companion opens as a sheet and closes with Escape; no page errors.

Screenshots at desktop and mobile sizes were inspected by eye. Issues found and fixed: long navigation
labels clipped at 1440 px (short labels now apply below 1580 px), brand and AI badge wrapping, Nuru's
floating bubble covering the composer in Study Together (Nuru now speaks inside its own panel there),
wide scene bands cropping both faces, the desk preview over-zooming, and an over-long landing headline.

## 3. Pending — not verified
- **Live AI with a real key** (README §3 "Live verification procedure"). Live paths were only exercised with mocks.
- Screen-reader testing (NVDA/VoiceOver); Safari and Firefox (only Chromium was run).
- Emotional-support wording reviewed by a qualified person, and a verified `SUPPORT_CONTACT_TEXT`.
- `setup.bat` / `start.bat` were not re-run; the equivalent steps were run manually on Windows.
- Hosting/HTTPS deployment, multi-process rate limiting, load.
