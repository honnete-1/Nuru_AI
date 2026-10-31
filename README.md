# Calm Scholar

**Calm Scholar helps students organize, learn and revise, and feel supported, with Nuru studying alongside them.**

Nuru, a folded-paper lantern, is an AI study buddy that sits beside the student through
coursework, revision, achievements and frustrations. The app is organised around three purposes:

- **Organize**: assignments, deadlines, steps, priorities and a study plan the student approves.
- **Learn and revise**: explanations with examples and citations from the student's own notes,
  and a recall-first **Revise with Nuru** journey.
- **Stay supported**: after a result or a hard day, Nuru asks how the student feels first, then
  offers to talk, pause, look at feedback, prepare a question for the lecturer, or pick one step.

Focus sessions, progress, desk keepsakes and personalization support those three purposes.
The central experience is **Study Together**: the student's avatar and Nuru sit side by side at
a shared desk, and the work (an assignment step, notes, an explanation or a practice question)
sits in a shared notebook in the middle.

It is a Django + SQLite application with a no-build vanilla JavaScript frontend.
It needs no Node, no CDN, no Docker, and no database server.

> **Starting point.** This build upgrades the supplied `Calm-Scholar-AI.zip` (Django 5.2 + SQLite,
> 18 passing tests). The existing schema was extended with migrations. A data migration
> keeps every existing account, assignment, step, session, check-in and focus log, and it is
> tested in `tests/test_migrations.py`. The RwandaWays source was used as a reference for the
> *level* of visual care (fluid type scale, rhythm, reveal motion, reduced-motion handling).
> None of its content, branding or layout was copied. All artwork is original, code-native SVG.

---

## 1. Start on Windows

1. Extract the whole ZIP to a folder, e.g. `D:\projects\calm-scholar`.
2. Install **Python 3.11 – 3.13** from python.org and tick **"Add Python to PATH"**.
3. Double-click **`setup.bat`**. It creates `.venv`, installs dependencies, copies
   `.env.example` to `.env` (only if `.env` doesn't exist yet) and runs migrations.
   It needs internet access the first time.
4. Double-click **`start.bat`**, then open **http://127.0.0.1:8000**.
5. Keep that window open while you use the app. Stop it with `Ctrl+C`.

Your data lives in `db.sqlite3` and `private_uploads\`. Both survive restarts and
re-running `setup.bat`, which only applies new migrations.

### Manual setup (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

### macOS / Linux

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
.venv/bin/python manage.py migrate && .venv/bin/python manage.py runserver
```

## 2. Create an account and explore

- **Create your account** registers a private account. A five-step welcome (name, how your
  seat looks and Nuru's light, one optional course and goal, usual study time, and privacy
  choices) can be skipped at any point. It ends with **Start studying with Nuru**.
- **Try a sample space** creates an *isolated* guest workspace with fictional
  sample data (two assignments, a lecture note, a quiz result and a review item). It's
  labelled as a sample, always uses scripted demo replies even if a key is configured,
  and is removed by `python manage.py cleanup_demos` after 7 days without a login.
  Sample data is only ever created when someone presses that button.

### Where things are

| Navigation (short label) | What it's for |
|---|---|
| **Today** | "What would help you today?" with six actions in three groups, plus today's next step, upcoming deadlines, continue where we stopped, and topics ready to revisit |
| **Study Together** (Study) | The shared desk: choose an assignment step, notes, "help me understand something" or **Revise with Nuru**; work in the notebook with Nuru's panel beside it |
| **Assignments & Study Plan** (Assignments) | Create and edit assignments, steps, priorities and deadlines; preview and approve a weekly plan |
| **My Notes & Courses** (Notes) | Courses, PDF/TXT uploads, written notes, topics ready to revisit |
| **Talk to Nuru** | General conversation, or "I need to talk" |
| **Grades & Check-ins** (Grades) | Feeling-first support around results, and optional check-ins |
| **My Progress** (Progress) | Steps, focus time, practice vs checked answers, and desk keepsakes |
| Account menu | Settings & privacy, Our study space (avatar, Nuru's colour, window, light, sound, motion), export, log out |

On phones the bottom bar shows Today, Study, Assignments and Notes; **More** opens the rest.
Long labels appear on wide screens and short ones where space is tight; every item keeps its
full name as a tooltip. Old links (`#/desk`, `#/keepsakes`, `#/ambience`, `#/companion/learn`) redirect.

### The Study Together journey

1. Open an assignment, see its checklist, and choose **Work on this** for one step.
2. Press **Help me here** at any time. The companion panel shows exactly what is shared
   ("Shared with Nuru: this step · this assignment") and offers prompts for that context:
   clarify the requirements, suggest a smaller step, interpret the brief. Notes, a selected
   passage, the study plan, a revision question and a result each have their own prompts.
3. Start a focus session sized to the step. It runs inline, keeps going if you switch pages
   (a timer pill in the top bar takes you back), and survives a reload.
4. Finish to save it, mark the step done, or choose the next step. **Continue where we stopped**
   on Today takes you back to the same step on any device.

Suggested steps from Nuru are editable proposals until you approve them. Your working notes
for each assignment save automatically and are only sent to the AI if you paste them into a message.
The companion panel can be hidden during focused work; **Help me here** stays visible.

## 3. Live AI vs Demo mode

Without a key, the companion runs in **Demo mode: scripted responses**. Every
reply says so, and a banner explains it. Planning, notes, uploads, citations (by plain
retrieval), focus, grades, revision records and keepsakes all work for real.

To enable live AI, edit `.env` **on the server machine** (never paste a key into the app or a chat):

```dotenv
OPENAI_API_KEY=your-own-key
OPENAI_MODEL=gpt-4.1-mini        # any Chat Completions model on your account that supports JSON output
# OPENAI_BASE_URL=               # optional OpenAI-compatible endpoint
```

Restart `start.bat`. The badge in the top bar changes to **Live AI**.

How live calls behave:
- The server calls Chat Completions with JSON output, `max_completion_tokens`
  (default 900), a 25 s timeout, no SDK retries and `store=false`. Each request is
  bounded: up to 12 prior turns, at most 4 note passages, and capped input.
- Every reply is validated. Citations may only name passages the server supplied, and
  proposed steps may only target the student's own assignments. Proposals are shown as
  editable cards and are saved only when the student approves them.
- If a live request fails (timeout, rate limit, provider unavailable, invalid JSON), the
  reply is labelled **Fallback: scripted, not live AI** along with the reason. Provider error
  text is never shown or logged with request content.
- Per-student daily limit: `AI_DAILY_LIMIT` (60). The limit uses Django's cache; with
  several server processes, configure a shared cache.
- `store=false` asks the provider not to store responses. That alone doesn't guarantee
  zero retention. Check your provider's data policy before a pilot.

### Live verification procedure (pending, because no key was available while building)

1. Put a key in `.env` and restart. Confirm the top badge reads **Live AI**.
2. In **Nuru → Talk**, send three different, related messages. Expect varied, specific
   replies labelled **Live AI** that build on earlier turns.
3. Upload a text PDF in My Notes & Courses, choose **Study these notes together**, select a
   passage on page 2 and press **Explain this passage in plain words**. Then ask about something else
   on page 2. Expect a "From your notes" block whose citation opens the
   exact page-2 passage. Then ask something the notes don't cover and expect a note saying so.
4. In **Revise with Nuru**, start a topic. Expect a question *before* any explanation; answer it and
   expect a verdict and a flag button. Flag it, finish, and check the summary does not count it.
   Open an assignment step in Study Together and press **Help me here**; "What was sent" should
   list the assignment and the step only.
5. Grades & Check-ins: log a 92% and choose *Disappointed*, then *Look at the feedback
   together*, tick only "Lecturer feedback", and talk. "What was sent" should list only what
   you ticked.
6. Set `OPENAI_MODEL=not-a-model`, restart, and send a message. Expect a labelled fallback.

You can also exercise the real SDK/HTTP path without a key using the local stand-in
`tools/fake_provider.py` (instructions inside). It is **not** an AI.

## 4. Tests

```powershell
run_tests.bat
```
or `python -m pip install -r requirements-dev.txt; python -m pytest -q; python manage.py check`.

- `tests/test_study_together.py` covers the Study Together redesign: terminology, Today, Help me here
  contexts and ownership, resume, working notes, focus-to-step, recall-first revision, feeling-first
  results, reward duplication and AI failure labelling (mocked provider).
- `tests/test_acceptance.py` covers the 14 acceptance areas in the earlier brief (mocked provider).
- `tests/test_workflows.py` holds the original 18 tests, updated for the new API shape.
- `tests/test_migrations.py` checks that an old database upgrades without losing records.
- `tools/browser_check.py` is an optional real-browser check (Playwright) of the connected journeys:
  onboarding, finding an assignment, Study Together with Help me here, focus across navigation,
  drafts across navigation and reload, plan approval, revision, a disappointing result, keyboard
  use, mobile layout and the companion sheet, and reduced motion.

See **TEST_REPORT.md** for exactly what was run and what is still pending.

## 5. Privacy and support boundaries

- All reads and writes are scoped to the logged-in student. Uploads are stored in
  `private_uploads/` (outside `static/`) and served only through an owner-checked view.
- Saved chat history is **off** by default. Turning it off deletes it. Without it,
  conversations last only while the tab is open (the browser holds them; the server
  stores nothing).
- Learning memory holds only items the student approves. Each one is visible, editable
  and deletable, and turning memory off forgets everything.
- Grades are optional. A result can be discussed **without being saved**. Before discussing
  a result, the student ticks exactly what is sent (the mark and the feedback are separate).
  Grades never affect keepsakes, rankings or anything public.
- Export everything as JSON, and delete chat, check-ins, journal entries, materials or the
  whole account (including files) from Settings.
- Whoever runs the installation can technically read the database and the uploaded files. This is
  not clinical confidentiality.
- Nuru is an AI study companion, not therapy or an emergency service. A limited keyword
  backstop shows a safety message without calling the provider. It is **not** a reliable
  risk assessment. Before any emotional-support pilot you need human review of the flows and a
  verified local support contact in `SUPPORT_CONTACT_TEXT`.

## 6. Hosting the real application

Django + SQLite needs a Python host with a **persistent disk**. Static hosting can't
run it.

1. `.env`: `DEBUG=false`, a strong `DJANGO_SECRET_KEY`, real `ALLOWED_HOSTS` and
   `CSRF_TRUSTED_ORIGINS`. Put `DATABASE_PATH` and `PRIVATE_MEDIA_ROOT` on the persistent disk.
2. `python manage.py migrate && python manage.py collectstatic --noinput && python manage.py check --deploy`
3. Run behind HTTPS with a WSGI server (`gunicorn config.wsgi:application --workers 1`), and let
   the web server serve `/static/` from `staticfiles/`. Never expose `private_uploads/`.
4. Schedule `python manage.py backup_db <new-path>` (back up `private_uploads/` too) and
   `python manage.py cleanup_demos`. Test a restore.
5. Before broad access, add a shared cache for rate limits, login throttling, monitoring and a
   provider spending cap.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `python` not found | Reinstall Python with "Add to PATH", or use `py -3 -m venv .venv`. |
| `setup.bat` fails on pip | Check your internet or proxy and run it again. Existing data is untouched. |
| Port 8000 in use | `.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8010` |
| Badge still says Demo mode | The key is in `.env` next to `manage.py`, and the server was restarted. Sample spaces are always demo. |
| "Fallback: … rate-limiting" | Provider quota or rate limit. Wait, or check billing. |
| Uploaded PDF says "No readable text" | It's a scanned PDF (images). Use a text-based copy or paste the key text as a note. |
| "Security token expired" | Reload the page. If you're hosting, set `CSRF_TRUSTED_ORIGINS` to your https origin. |
| The scene doesn't move | Motion may be reduced (system setting or Account menu → Our study space → Motion). That's intended. |

## 8. Project map

```
config/                 settings (env-driven), URLs
scholar/models.py       all records (accounts, courses, materials, passages, results, rewards…)
scholar/views.py        account-scoped JSON actions, uploads, export
scholar/ai.py           provider calls, validation, live/demo/fallback/safety labelling
scholar/demo_ai.py      clearly labelled scripted responses (not the live chatbot)
scholar/retrieval.py    PDF/TXT extraction, page-aware passages, BM25 search
scholar/planner.py      deterministic planning and "I have 20 minutes"
scholar/results.py      feeling-first openings for grades, multi-scale results
scholar/rewards.py      idempotent keepsake rules
templates/partials/     scene.html (avatar + Nuru at a shared desk), nuru.html (the companion)
static/js/app/          ES modules: main, scene, focus, onboarding, views/{today,study,companion,plan,library,journal,core_views,challenge}
static/js/app.js        unused file from the original upload, kept untouched (not loaded by any page)
static/fonts/           Fraunces, Inter, Caveat (SIL OFL, bundled)
tests/                  pytest suite;  tools/  browser check + fake provider
```

More detail: **ARCHITECTURE.md**, **TEST_REPORT.md**, **STATUS.md**, **THIRD_PARTY.md**.
