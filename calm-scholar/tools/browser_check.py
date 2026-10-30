"""Real-browser checks (optional; needs `pip install playwright` and `python -m playwright install chromium`).

Run the server first (python manage.py runserver), then:
    python tools/browser_check.py http://127.0.0.1:8000 [screenshot-folder]

Walks the connected journeys a new student takes: onboarding, finding an assignment
without room terminology, Study Together with Help me here, working notes, a focus session
that survives navigation, a draft that survives navigation and reload, plan preview and
approval, Revise with Nuru, a disappointing result, keyboard use, mobile layout and the
companion sheet, and reduced motion. Prints PASS/FAIL per check.
"""
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000').rstrip('/')
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None
results = []


def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f' ({detail})' if detail and not cond else ''))


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=False)


def register(page):
    page.goto(BASE + '/accounts/register/')
    page.fill('#display_name', 'Ama')
    page.fill('#id_username', f'check{int(time.time() * 1000)}')
    page.fill('#id_password1', 'Lantern-light-2026!')
    page.fill('#id_password2', 'Lantern-light-2026!')
    page.click('button:has-text("Create my account")')
    page.wait_for_url('**/app/**')


def title(page):
    return page.inner_text('#panel-title').strip()


def go(page, hash_):
    page.evaluate(f"location.hash = '{hash_}'")
    page.wait_for_timeout(350)


with sync_playwright() as p:
    browser = p.chromium.launch()
    # ================= desktop =================
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page(); page.set_default_timeout(10000)
    page.on('dialog', lambda d: d.accept())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    register(page)
    page.wait_for_selector('#ob-form')
    check('onboarding introduces Nuru as an AI study buddy', 'your AI study buddy. We can organize your work' in page.inner_text('#ob-form'))
    for _ in range(4):
        page.click('#ob-form button.btn-primary')
    check('onboarding ends with "Start studying with Nuru"', page.is_visible('button:has-text("Start studying with Nuru")'))
    page.click('#ob-form button.btn-primary'); page.wait_for_timeout(600)
    check('onboarding completes', not page.is_visible('#ob-form'))
    check('Today asks "What would help you today?"', title(page) == 'Today' and page.is_visible('text=What would help you today?'))
    check('six labelled help actions on Today', page.locator('.help-action').count() == 6)
    check('no furniture objects act as navigation', page.locator('[data-obj]').count() == 0)
    shot(page, 'desktop-today')

    # keyboard: Tab to the Assignments nav item and open it
    page.focus('body'); reached = False
    for _ in range(25):
        page.keyboard.press('Tab')
        if page.evaluate("document.activeElement?.dataset?.nav === 'plan'"):
            reached = True; break
    page.keyboard.press('Enter'); page.wait_for_timeout(400)
    check('keyboard reaches and opens Assignments & Study Plan', reached and title(page) == 'Assignments & Study Plan', title(page))

    # add an assignment and find its steps
    page.click('[data-act="new-assignment"] >> nth=0')
    page.fill('dialog [name=title]', 'Design report')
    page.fill('dialog [name=due]', str(date.today() + timedelta(days=6)))
    page.fill('dialog [name=description]', 'Write a 1500-word design report with user journeys and risks.')
    page.click('dialog button:has-text("Add assignment")'); page.wait_for_timeout(600)
    page.click('button:has-text("Suggest steps")'); page.wait_for_timeout(900)
    check('assignment steps are suggested and editable', page.locator('.step-row').count() >= 3)
    page.click('button:has-text("Study this together")'); page.wait_for_timeout(700)
    check('assignment opens in Study Together with its checklist', title(page) == 'Study Together' and page.locator('.checklist li').count() >= 3)
    check('the current step is shown and highlighted', page.is_visible('.current-step') and page.locator('.checklist li.current').count() == 1)
    check('student avatar and Nuru are both in the scene', page.locator('.study-scene .sc-student').count() == 1 and page.locator('.study-scene .sc-nuru .nuru').count() == 1)

    # Help me here, in context
    page.click('.companion .help-here'); page.wait_for_timeout(200)
    check('Help me here focuses the composer', page.evaluate("document.activeElement?.id === 'chat-input'"))
    chip = page.inner_text('.companion .context-chip')
    check('the companion says what context is shared', 'Shared with' in chip and 'Read the brief' in chip, chip)
    page.click('.companion .prompt-chips .chip >> nth=0')
    page.wait_for_selector('.companion .msg.ai .ai-badge >> nth=-1')
    label = page.inner_text('.companion .msg.ai .ai-badge >> nth=-1')
    check('the reply carries an AI-mode label', label in ('Live AI', 'Demo mode: scripted response', 'Fallback: scripted, not live AI'), label)
    check('still on the same step after asking for help', page.locator('.checklist li.current').count() == 1)
    shot(page, 'desktop-study')

    # working notes autosave
    page.fill('#wnotes', 'Check the rubric for the risk section.')
    page.wait_for_function("document.querySelector('#wnotes-status')?.textContent === 'Saved'", timeout=6000)
    check('working notes save automatically', True)

    # focus session that survives navigation
    page.click('button:has-text("-minute focus")'); page.wait_for_timeout(800)
    check('focus starts inline (not a blocking overlay)', page.is_visible('.focus-card [data-focus-time]') and page.is_visible('#chat-input'))
    go(page, '#/home')
    check('focus pill stays visible on Today', page.is_visible('.focus-pill'))
    page.click('.focus-pill button:has-text("Back to it")'); page.wait_for_timeout(500)
    check('"Back to it" returns to the same step', title(page) == 'Study Together' and page.is_visible('.focus-card'))
    page.click('.focus-card button:has-text("Finish")'); page.wait_for_timeout(800)
    check('finishing saves and offers to mark the step done', page.is_visible('.focus-card.saved') and page.is_visible('button:has-text("Mark")'))
    page.click('.focus-card.saved button:has-text("Skip")'); page.wait_for_timeout(400)
    state = page.evaluate("fetch('/api/state/').then(r => r.json())")
    check('focus saved exactly once, linked to its step', len(state['focus']) == 1 and state['focus'][0]['step_id'] is not None)
    check('Today offers to continue where we stopped', state['resume'] and state['resume']['kind'] == 'assignment')

    # collapse the companion during focused work
    page.click('.collapse-btn'); page.wait_for_timeout(300)
    check('companion collapses and Help me here stays visible', page.locator('.study.is-collapsed').count() == 1 and page.is_visible('.companion .help-here'))
    page.click('.collapse-btn'); page.wait_for_timeout(300)

    # drafts survive navigation and reload
    go(page, '#/companion')
    page.fill('#chat-input', 'A half-written question')
    go(page, '#/home'); go(page, '#/companion')
    check('chat draft survives navigation', page.input_value('#chat-input') == 'A half-written question')
    page.reload(); page.wait_for_selector('#chat-input')
    check('chat draft survives a reload in this tab', page.input_value('#chat-input') == 'A half-written question')

    # plan: preview, then approve
    go(page, '#/plan/week')
    page.click('button:has-text("Preview a fresh plan")'); page.wait_for_timeout(600)
    check('plan preview changes nothing until approved', page.is_visible('text=Preview: nothing has changed yet'))
    page.click('button:has-text("Use this plan")'); page.wait_for_timeout(600)
    state = page.evaluate("fetch('/api/state/').then(r => r.json())")
    check('approved plan is saved', len(state['sessions']) > 0)

    # revise: attempt before explanation
    go(page, '#/home')
    page.click('.help-action:has-text("Revise with me")'); page.wait_for_timeout(400)
    page.fill('form[data-form="revise-start"] [name=topic]', 'User journeys')
    page.click('button:has-text("Start with a question")')
    page.wait_for_selector('form[data-form="revise-answer"]')
    check('revision starts with a question, not an explanation', page.is_visible('.question-text') and page.locator('.notebook .from-notes').count() == 0)
    page.fill('form[data-form="revise-answer"] textarea', 'A user journey maps the steps a person takes to reach a goal.')
    page.click('button:has-text("Check my answer")'); page.wait_for_timeout(800)
    check('feedback appears after the attempt', page.is_visible('button:has-text("Try a related question")'))
    page.click('button:has-text("Try a related question")'); page.wait_for_selector('form[data-form="revise-answer"]')
    page.click('button:has-text("A different question")'); page.wait_for_selector('form[data-form="revise-answer"]')
    page.click('form[data-form="revise-answer"] textarea')
    page.fill('form[data-form="revise-answer"] textarea', 'It helps find pain points.')
    page.click('button:has-text("Check my answer")'); page.wait_for_timeout(800)
    page.click('button:has-text("Finish and summarise")'); page.click('button:has-text("See my summary")'); page.wait_for_timeout(700)
    summary = page.inner_text('.summary') if page.is_visible('.summary') else ''
    check('revision ends with an honest summary and a review date', 'questions attempted' in summary and 'not a mastery score' in summary, summary[:120])
    shot(page, 'desktop-revise')

    # results: disappointment is met with choices
    go(page, '#/home')
    page.click('.help-action:has-text("I got my results")'); page.wait_for_timeout(400)
    page.fill('form[data-form="result-1"] [name=title]', 'Midterm')
    page.fill('form[data-form="result-1"] [name=score]', '92')
    page.click('form[data-form="result-1"] button:has-text("Next")'); page.wait_for_timeout(300)
    check('Nuru asks how they feel before responding', page.is_visible('text=how do you feel about it?'))
    page.click('[data-feel="disappointed"]'); page.click('#feel-next'); page.wait_for_timeout(500)
    opening = page.inner_text('.opening')
    check('a disappointing 92 is acknowledged with choices, not a checklist', "wasn't the result you hoped for" in opening and 'Pause for now' in opening and 'Prepare a question for my lecturer' in opening)
    check('no uncaught page errors (desktop)', not errors, '; '.join(errors))
    ctx.close()

    # ================= reduced motion =================
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
    page = ctx.new_page(); page.set_default_timeout(10000)
    register(page); page.click('#ob-skip'); page.wait_for_timeout(500)
    dur = page.evaluate("getComputedStyle(document.querySelector('.today-scene .sc-student')).animationDuration")
    check('reduced motion stops the scene animation', dur in ('0s', '1e-06s') or dur.startswith('1e-') or dur == '0.001ms', dur)
    ctx.close()

    # ================= mobile =================
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page(); page.set_default_timeout(10000)
    page.on('dialog', lambda d: d.accept())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    register(page); page.click('#ob-skip'); page.wait_for_timeout(500)
    page.evaluate("""fetch('/api/action/', {method:'POST', headers:{'Content-Type':'application/json','X-CSRFToken':decodeURIComponent(document.cookie.split('; ').find(s=>s.startsWith('csrftoken=')).split('=')[1])},
      body: JSON.stringify({action:'assignment_save', title:'Lab write-up', course:'Biology', due:'%s', minutes:90})}).then(r=>r.json())""" % (date.today() + timedelta(days=4)))
    page.reload(); page.wait_for_timeout(600)
    for route in ['home', 'study', 'plan', 'library', 'companion', 'journal', 'progress', 'settings', 'space', 'study/revise']:
        go(page, f'#/{route}')
        over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        check(f'mobile "{route}" has no horizontal scroll', over <= 1, f'{over}px')
        shot(page, 'mobile-' + route.replace('/', '-'))
    nav_box = page.locator('#mainnav').bounding_box()
    check('mobile navigation sits at the bottom', nav_box and nav_box['y'] > 700, str(nav_box))
    small = page.evaluate("[...document.querySelectorAll('#mainnav button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length")
    check('mobile navigation targets are at least 44px', small == 0)
    page.click('#nav-more'); page.wait_for_timeout(200)
    check('"More" opens Talk to Nuru, Grades and Progress', page.is_visible('#more-sheet button:has-text("Talk to Nuru")') and page.is_visible('#more-sheet button:has-text("Grades")'))
    page.click('#more-sheet button:has-text("My Progress")'); page.wait_for_timeout(300)
    check('More sheet navigates', title(page) == 'My Progress')
    go(page, '#/study'); page.click('.notebook .item.clickable >> nth=0'); page.wait_for_timeout(500)
    check('mobile Study Together shows a compact companion button', page.is_visible('.help-fab') and not page.is_visible('.companion'))
    page.click('.help-fab'); page.wait_for_timeout(600)
    check('Help me here opens the companion sheet', page.is_visible('.companion #chat-input'))
    shot(page, 'mobile-study-sheet')
    page.keyboard.press('Escape'); page.wait_for_timeout(600)
    check('Escape closes the sheet', page.locator('.study.sheet-open').count() == 0)
    check('no uncaught page errors (mobile)', not errors, '; '.join(errors))
    browser.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
