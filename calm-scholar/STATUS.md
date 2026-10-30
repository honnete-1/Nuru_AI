# Project status (for continuing work)

**Purpose:** Calm Scholar helps students organize, learn and revise, and feel supported, with Nuru
studying alongside them.

**Latest change (2026-10-30): the Study Together redesign.** The room-as-menu was replaced by labelled
navigation (Today, Study Together, Assignments & Study Plan, My Notes & Courses, Talk to Nuru,
Grades & Check-ins, My Progress). New: the Today screen ("What would help you today?"), the Study
Together workspace (avatar and Nuru side by side, shared notebook, collapsible companion, Help me here
with explicit context), inline focus that survives navigation, server-side "continue where we stopped",
per-assignment working notes, a recall-first Revise with Nuru journey, a "prepare a question for my
lecturer" option after results, avatar customization, and a revision keepsake. Migration 0004 is additive.

**Already in place from earlier work:** labelled live/demo/fallback/safety modes; consent controls for
history, memory and workload; citations to exact passages; deterministic planning with approval;
feeling-first results; idempotent rewards; export and deletion.

**Tests:** 80 automated (all passing), 52 real-browser checks (all passing). See TEST_REPORT.md.

**Pending (needs the owner):** live-provider verification with a real key (README §3); a verified
`SUPPORT_CONTACT_TEXT` and human review before any emotional-support pilot; screen-reader and
non-Chromium testing; hosting.

**Next ideas:** per-weekday availability; streaming replies; OCR; shared-cache rate limits; saving
in-session conversations per assignment when history is on.
