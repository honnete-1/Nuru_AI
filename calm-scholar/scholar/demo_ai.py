"""Scripted responses for Demo mode and labelled fallbacks.

These are NOT the live chatbot. Every response produced here is returned with
mode="demo" or mode="fallback" and the interface labels it as scripted. They
exist so that the app stays usable without a provider key, and so that a live
failure never looks like a successful AI reply.

Where the student's own notes match a question, the demo quotes the matching
passage verbatim. That is plain retrieval, so the citation is still real.
"""
import hashlib
import random
import re


def _pick(options, seed):
    rnd = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16))
    return rnd.choice(options)


def _topic(message):
    m = re.sub(r'\s+', ' ', message or '').strip().rstrip('?.!')
    m = re.sub(r'^(can you |please |could you )?(help me )?(explain|understand|learn|tell me about|what is|what are|how does|how do)\s+', '', m, flags=re.I)
    return (m[:80] or 'this topic')


def _quote(sources, query=''):
    """Quote, verbatim, the sentence of the best passage that overlaps most with the question."""
    if not sources:
        return []
    from .retrieval import tokens
    s = sources[0]
    q = set(tokens(query))
    sentences = [x for x in re.split(r'(?<=[.!?])\s+', s['text'].strip()) if x]
    best = max(sentences, key=lambda x: len(q & set(tokens(x)))) if q else sentences[0]
    return [{'text': best[:300], 'passage_ids': [s['id']]}]


def companion(message, *, name='Nuru', context=None, sources=None, intent='chat', topic=''):
    sources = sources or []
    topic = (topic or '').strip()[:80] or _topic(message)
    supported = _quote(sources, message)
    note = (' I found a passage in your notes that matches, shown below with its source.' if supported
            else (' I looked through your notes and did not find a passage that covers this, so anything here is general.' if intent.startswith('tutor') else ''))
    out = {'nuru': 'explaining', 'supported': supported, 'proposals': [], 'suggestions': []}

    if intent == 'tutor_explain':
        out['reply'] = (f'(Scripted demo) Here is how a tutoring step would work for "{topic}".{note}\n\n'
                        'In live mode I would explain the idea in plain words, then give one concrete example from everyday life. '
                        'For now, try this: write one sentence describing what you already know about it, and one thing that feels unclear.')
        out['suggestions'] = ['Give me a hint', 'Show a worked example', 'Try a practice question']
    elif intent == 'tutor_hint':
        out['reply'] = (f'(Scripted demo) A hint for "{topic}": break it into the inputs, the process, and the result. '
                        'Which of those three parts feels least clear to you?')
        out['nuru'] = 'listening'
        out['suggestions'] = ['Show a worked example', 'Try a practice question']
    elif intent == 'tutor_worked':
        out['reply'] = (f'(Scripted demo) A worked example would walk through a similar problem one line at a time, '
                        'naming why each step follows from the last. Live AI writes one specific to your topic.')
        out['suggestions'] = ['Try a practice question']
    elif intent == 'tutor_practice':
        out['reply'] = f'(Scripted demo) Practice: In two or three sentences, explain "{topic}" to a classmate who missed the lecture.'
        out['nuru'] = 'listening'
    elif intent == 'revise_recall':
        out['nuru'] = 'listening'
        prev = (context or {}).get('previous_question') or ''
        templates = [f'Without looking at your notes, explain "{topic}" in two or three sentences, as if to a classmate.',
                     f'Give one example of "{topic}" and say why it is an example.',
                     f'What is one common mistake people make about "{topic}", and how would you avoid it?',
                     f'How does "{topic}" connect to something else you have studied in this course?']
        if sources:
            words = ' '.join(sources[0]['text'].split()[:8])
            templates.insert(1, f'Your notes ({sources[0]["material"]}) have a passage beginning "{words}". Without looking, what does it go on to explain?')
        options = [t for t in templates if t not in prev] or templates
        out['reply'] = '(Scripted demo) Practice: ' + _pick(options, prev + topic)
        out['supported'] = []
    elif intent == 'step_help' and context:
        step = context.get('current_step') or {}
        name = step.get('title') or context.get('title', 'this step')
        out['reply'] = (f'(Scripted demo) Let us look at "{name}". A smaller first move: spend ten minutes writing down, '
                        'in your own words, what this step needs you to produce. Which part of it feels least clear?')
        out['proposals'] = [{'type': 'add_step', 'assignment_id': context['id'], 'title': f'Ten minutes: list what "{name[:80]}" needs', 'minutes': 10, 'stage': 'discover'}]
        out['suggestions'] = ['Explain a concept from it', 'Suggest a smaller step']
    elif intent == 'passage_explain':
        out['reply'] = ('(Scripted demo) The passage you selected is quoted above with its source. In live mode I would explain it in plain words '
                        'with an example. For now, try restating it in one sentence of your own.') if supported else (
                        '(Scripted demo) I could not match that passage, so I cannot explain it here.')
    elif intent == 'plan_help':
        alerts = (context or {}).get('alerts') or []
        out['reply'] = ('(Scripted demo) ' + (f'{len(alerts)} item(s) in your plan need attention. ' if alerts else 'Your plan currently fits your availability. ')
                        + 'Options you control: make a step smaller, adjust your daily time or pace in Settings, or ask your lecturer about a deadline. '
                        'Nothing changes until you approve a new plan.')
    elif intent == 'result_question':
        out['reply'] = ('(Scripted demo) A question you could adapt:\n\n"Thank you for the feedback on [assignment]. You mentioned [comment]. '
                        'Could you show me an example of what that would look like, so I can apply it next time?"\n\nYou decide whether to ask it.')
    elif intent == 'support_talk':
        out['nuru'] = 'supporting'
        out['reply'] = _pick(['(Scripted demo) I am here, and there is no rush. How are you feeling right now? We can keep talking, take a pause, or pick one small next step, whichever suits you.',
                              '(Scripted demo) Thank you for saying something. How are you feeling about it right now? We can talk it through, pause for a while, or pick one small next step.'], message)
        out['suggestions'] = ['Keep talking', 'I need a pause', 'Pick one small next step']
    elif intent == 'result_talk':
        out['nuru'] = 'supporting'
        out['reply'] = _pick([
            '(Scripted demo) Thank you for sharing that with me. There is no right way to feel about a result. What part of it is sitting with you most right now?',
            '(Scripted demo) I am glad you said something. We can take this at whatever pace suits you. Would it help more to say what you hoped for, or what surprised you?',
        ], message)
    elif intent == 'result_feedback':
        out['reply'] = ('(Scripted demo) A useful way into feedback: copy each comment into one of three piles: '
                        '"I understand and agree", "I understand but disagree", "I do not understand yet". '
                        'The third pile is a good source of a question for your lecturer. Which comment would you like to start with?')
    elif intent == 'result_plan':
        aid = context.get('assignment_id') if context else None
        out['reply'] = '(Scripted demo) One small next step could be a 20-minute session rewriting a single paragraph using one feedback point. You can edit it before anything is saved.'
        if aid:
            out['proposals'] = [{'type': 'add_step', 'assignment_id': aid, 'title': 'Apply one feedback point to a single paragraph', 'minutes': 20, 'stage': 'practice'}]
    elif intent == 'draft_request':
        out['reply'] = ('(Scripted demo) Here is a starting draft you can edit:\n\n'
                        'Dear [lecturer name],\n\nI am working on [assignment] for [course]. I have planned my time carefully, '
                        'but the remaining work does not fit before [deadline] because [your reason]. Would it be possible to discuss [an extension / a reduced scope / clarification on ...]?\n\n'
                        'Thank you for your time,\n[your name]\n\nYou decide whether and when to send it.')
    elif intent == 'assignment' and context:
        title = context.get('title', 'this assignment')
        out['reply'] = (f'(Scripted demo) Let us look at "{title}" together. A good first move is to read the brief once and underline every verb it uses '
                        '(analyse, compare, design...). Those verbs tell you what the marker is looking for. Which part of the brief feels least clear?')
        out['suggestions'] = ['Break it into steps', 'I have 20 minutes', 'Explain a concept from it']
    elif supported:
        out['reply'] = ('(Scripted demo) The passage from your notes that best matches your question is shown above, with its source. '
                        'In live mode I would explain it in plain words with an example. Would a learning session on this help?')
        out['suggestions'] = ['Start a learning session']
    else:
        lowered = (message or '').lower()
        if re.search(r'overwhelm|too much|stress|behind|tired|exhaust', lowered):
            out['nuru'] = 'supporting'
            out['reply'] = ('(Scripted demo) That sounds like a lot at once. We do not have to sort all of it now. '
                            'Would it help to pick just the nearest deadline, or to talk it through first?')
            out['suggestions'] = ['Pick the nearest deadline', 'I have 20 minutes', 'Talk it through']
        elif re.search(r'explain|understand|what is|how does|confus', lowered):
            out['reply'] = (f'(Scripted demo) I would love to help you understand {topic}.{note} '
                            'Open the Learn tab to go step by step: explanation, hint or example, then a short check.')
            out['suggestions'] = ['Start a learning session']
        else:
            out['nuru'] = 'listening'
            out['reply'] = _pick([
                '(Scripted demo) I am here to help you learn, plan, or think through a result. What would be most useful right now?',
                '(Scripted demo) Thanks for saying hello. Do you want to understand something, start an assignment, or plan your week?',
            ], message)
            out['suggestions'] = ['Explain something', 'Start an assignment', 'Plan my week']
    return out


def check_feedback(question, answer, concept):
    words = len((answer or '').split())
    return {
        'reply': ('(Scripted demo) Demo mode cannot evaluate your reasoning, so this is not feedback on correctness. '
                  f'You wrote {words} words. Compare your answer with your notes or textbook and ask: did I name the key idea, '
                  'give a reason, and use an example? Then choose how confident you feel below.'),
        'verdict': 'self', 'next_activity': 'Compare your answer with one trusted source.',
        'supported': [], 'nuru': 'listening', 'proposals': [], 'suggestions': [],
    }


STAGE_TEMPLATES = [
    ('discover', 'Read the brief for "{t}" and underline what it asks you to do', 0.12),
    ('explore', 'Gather the key readings or notes for "{t}"', 0.2),
    ('practice', 'Try one small example or outline of the main idea', 0.2),
    ('create', 'Draft the main part in your own words', 0.33),
    ('reflect', 'Check your work against the brief or rubric', 0.15),
]


def breakdown(assignment):
    total = assignment.minutes
    title = assignment.title[:60]
    steps, used = [], 0
    for i, (stage, text, share) in enumerate(STAGE_TEMPLATES):
        minutes = max(5, int(total * share)) if i < len(STAGE_TEMPLATES) - 1 else max(5, total - used)
        if used + minutes > total:
            minutes = max(1, total - used)
        used += minutes
        steps.append({'title': text.format(t=title), 'minutes': minutes, 'stage': stage})
    return {'steps': [s for s in steps if s['minutes'] > 0]}


def challenge(topic, kind, steps=None):
    if steps and len(steps) >= 3:
        return {'type': 'order', 'prompt': f'Put your own steps for "{topic}" into a sensible order. (Scripted demo: this checks your plan order, not subject knowledge.)',
                'items': steps[:6], 'hints': ['What do you need to understand before you can begin creating?', 'Checking against the brief usually comes last.'], 'self_generated': True}
    return {'type': 'explain', 'prompt': f'(Scripted demo) In two or three sentences, explain "{topic}" as if to a classmate who missed the lecture.',
            'hints': ['Start with what it is for, not its definition.', 'Add one example from your notes.']}
