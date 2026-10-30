# Architecture

## Shape
- **Django 5.2 + SQLite** (development and the small pilot). One app, `scholar`.
- **Server-rendered shell + JSON actions.** `/app/` renders a labelled navigation bar and a main
  panel. Views are small ES modules in `static/js/app/` that call one CSRF-protected endpoint,
  `POST /api/action/`, with `{"action": ..., ...}`. Every handler validates input on the server and
  scopes every query to `request.user`. Uploads use `POST /api/materials/upload/` (multipart).
- **No build step, no CDN.** Fonts and artwork are bundled. The Study Together scene
  (`templates/partials/scene.html`) is an illustration only (`role="img"`): the avatar (skin, hair,
  outfit), Nuru's colour, window view, light and unlocked keepsakes are data attributes and
  `has-<key>` classes. Every action is a real, labelled `<button>`; furniture is never navigation.
  Wide bands keep both faces in view; phones zoom in on the two seats instead of shrinking the room.

## Journeys and where they live
| Journey | Backend | Frontend |
|---|---|---|
| Today ("What would help you today?") | `serialize` (`next_action`, `resume`, `progress`) | `views/today.js` |
| Study Together: assignment step, notes, understand, revise | `h_resume_save`, `h_working_notes`, contexts in `build_context` | `views/study.js` |
| Help me here (context-aware companion) | `run_chat` + `build_context` types `assignment` (+`step_id`), `material`, `passage`, `plan`, `revision`, `result` | `views/companion.js` (`chatPanel`, `contextFor`) |
| Revise with Nuru (recall first) | `RevisionSession`, `h_revision_start/question/answer/finish` | `views/study.js` |
| Assignments, steps, guided challenge | `Assignment`, `Subtask.stage`, `ai.breakdown/challenge` | `views/plan.js`, `views/challenge.js` |
| Planning, "I have a little time" | `planner.py` (deterministic) | `views/plan.js`, `views/today.js` |
| Notes and citations | `retrieval.py`, `Material`, `Passage` | `views/library.js`, `views/study.js` |
| Grades & Check-ins (feeling first) | `results.py`, `ResultEntry` | `views/journal.js` |
| Focus (inline, survives navigation) | `FocusLog` (idempotent `client_token`, optional `subtask`) | `focus.js` |
| Progress, study space, onboarding | `Profile.avatar`, `Room`, `rewards.py` | `views/core_views.js`, `onboarding.js`, `scene.js` |

## Client state that must survive navigation
- **Focus**: wall-clock based, stored in `localStorage` (`cs-focus`); a top-bar pill shows it on every page.
- **Typed drafts** (chat, revision answers, unsaved working notes): `sessionStorage` (`cs-drafts`),
  cleared when the tab closes, matching "conversations last while this tab is open".
- **Where we stopped**: server-side (`Profile.resume`), re-validated on every read, so a deleted
  or finished item is never offered.

## AI layer (`scholar/ai.py`)
`interface → /api/action/ → views.run_chat → ai.companion → provider → validate → label → JSON → safe render`.

- Modes: `live`, `demo` (no key or sample room), `fallback` (live attempt failed; with a reason),
  `safety` (keyword backstop, no provider call). The UI renders a badge for each, and demo text is
  prefixed "(Scripted demo)".
- The system prompt holds Nuru's persona and boundaries. All student data goes in a JSON
  `data` field that the prompt declares untrusted. Document text never enters the system prompt.
- Validation: the reply is non-empty and bounded; `supported` claims must cite supplied passage ids;
  `add_step` proposals must target an assignment the server put in context; unknown fields are dropped.
- Context is explicit and disclosed. The response lists what was sent (`sent`), and the composer
  shows what *would* be sent before the student presses Send.

## Retrieval (`scholar/retrieval.py`)
pypdf extracts text per page, which is split into paragraph-aware passages of up to 700 characters.
Search is a compact BM25 over the student's own passages with a relevance floor, and returns at most
4 passages. No vector database is needed. A PDF with no text (a scan) is stored with status
`no_text` and an explanation. Damaged or encrypted files get `error`. Nothing is guessed.

## Planning (`scholar/planner.py`)
Seven days in the student's time zone (per-profile, applied by `StudentTimezoneMiddleware`),
deadline-first, 25-minute sessions with 5-minute breaks counted in the budget, capped per pace,
never in the past, no overlap with completed sessions. A preview is stored in the session and
must be confirmed. Confirmation replaces only unfinished future sessions. Missed past sessions
stay, unpunished. Warnings are structured (`overdue`, `missed`, `infeasible` with
`reduce_scope / adjust_availability / draft_request`).

## Rewards (`scholar/rewards.py`)
Seven rules, each tied to a real action (first completed step, first saved focus, first reflection,
five focus sessions, first *evaluated* on-track check, first finished assignment, first finished revision session). They are evaluated
from database records and stored with a unique `(user, key)`, so they're idempotent. Grades, check-ins,
chat volume and companion clicks are not inputs. Nothing is ever removed.

## Data model
Migration 0002/0003: `Course`, `Room`, `MemoryItem`, `Material`, `Passage`, `Concept`, `CheckAttempt`,
`ResultEntry`, `RewardEvent`; `Subtask.stage`, `Assignment.course_ref`, `FocusLog` reflection + token,
`ChatMessage.mode`. Migration 0004 (Study Together, additive only): `Profile.avatar`, `Profile.resume`,
`Assignment.working_notes`, `FocusLog.subtask`, `RevisionSession`, `CheckAttempt.revision`. The private
upload storage is now referenced through a callable so migrations never record a machine-specific path.

## Revision without invented scores
A revision summary reports counts only: questions attempted, answers **checked** as on track (live AI
or exact-answer checks, excluding flagged feedback), **self-checks**, and the student's **self-reported**
confidence. The next review is scheduled no later than the day before an assessment date, if given.
There are no mastery percentages or readiness predictions.

## Deliberately deferred
- Per-weekday availability and calendar import (one daily window for now).
- Streaming replies. Model-written challenge types beyond order/spot-the-error/explain.
- OCR for scanned PDFs (they're detected and explained instead).
- Shared-cache rate limiting, login throttling and monitoring for multi-process hosting.
- Email password reset.
- Human-reviewed emotional-support flows and verified local resources (required before any
  emotional-support pilot).
- A static, backend-free preview (the earlier `preview.html` was removed rather than left out of date).
