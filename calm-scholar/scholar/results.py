"""Results Journal: how Calm Scholar responds after a grade.

The first response depends ONLY on how the student says they feel, never on the
mark. A 92% can be disappointing; a 55% can be a proud improvement. These are
authored interface words (not AI). Further conversation, when the student
chooses it, goes through the companion with the result context they approve.
"""
from decimal import Decimal, InvalidOperation

FEELINGS = ['proud', 'relieved', 'disappointed', 'worried', 'mixed', 'other', 'skip']

HARD = ('disappointed', 'worried')
GOOD = ('proud', 'relieved')

OPTIONS = {
    'hard': [
        ('talk', 'Talk about it'),
        ('pause', 'Pause for now'),
        ('feedback', 'Look at the feedback together'),
        ('question', 'Prepare a question for my lecturer'),
        ('plan', 'Plan one next step'),
    ],
    'good': [
        ('celebrate', 'A small celebration'),
        ('quiet', 'Just note it quietly'),
        ('strategy', 'Record what helped'),
        ('break', 'Take a break'),
        ('next_goal', 'Think about what is next'),
    ],
    'open': [
        ('talk', 'Talk it through'),
        ('feedback', 'Understand the feedback'),
        ('question', 'Prepare a question for my lecturer'),
        ('strategy', 'Record what helped'),
        ('plan', 'Plan one next step'),
        ('pause', 'Leave it here for now'),
    ],
}


def tone_for(feeling):
    if feeling in HARD:
        return 'hard'
    if feeling in GOOD:
        return 'good'
    return 'open'


def opening(feeling, words='', effort_known=False):
    """Return {'tone', 'message', 'options', 'nuru'} for a feeling. Mark-independent by design."""
    tone = tone_for(feeling)
    words = (words or '').strip()
    if feeling == 'disappointed':
        message = ("That wasn't the result you hoped for, and it makes sense that it stings. "
                   "One mark doesn't measure you, and we don't have to fix anything right now. What would help most?")
    elif feeling == 'worried':
        message = ("It sounds like this result has left you uneasy. That's a reasonable thing to feel. "
                   "We can go slowly. Would you rather talk it through, or look at something concrete?")
    elif feeling == 'proud':
        message = "You're proud of this one. Let's enjoy that for a moment. How would you like to mark it?"
    elif feeling == 'relieved':
        message = "Relief is a good feeling to notice. You carried this through. What would you like to do with this moment?"
    elif feeling == 'mixed':
        message = "Mixed feelings make sense. Results rarely mean just one thing. What kind of support would help right now?"
    elif feeling == 'other' and words:
        message = f"Thank you for putting it in your own words: “{words[:140]}”. What kind of support would help right now?"
    else:
        message = "No need to name a feeling. What would be most useful from here?"
    return {'tone': tone, 'message': message, 'options': [{'key': k, 'label': l} for k, l in OPTIONS[tone]],
            'nuru': {'hard': 'supporting', 'good': 'celebrating', 'open': 'listening'}[tone]}


def parse_result(data):
    """Validate a result of any scale. Returns dict of model fields. Raises ValueError."""
    kind = data.get('result_kind', 'none')
    if kind not in ('percent', 'points', 'text', 'none'):
        raise ValueError('result kind')
    out = {'result_kind': kind, 'score': None, 'out_of': None, 'result_text': ''}

    def num(v):
        try:
            d = Decimal(str(v))
        except (InvalidOperation, TypeError):
            raise ValueError('number')
        if not d.is_finite():
            raise ValueError('number')
        return d.quantize(Decimal('0.01'))

    if kind == 'percent':
        out['score'] = num(data.get('score'))
        if not Decimal(0) <= out['score'] <= Decimal(100):
            raise ValueError('percent range')
    elif kind == 'points':
        out['score'], out['out_of'] = num(data.get('score')), num(data.get('out_of'))
        if out['out_of'] <= 0 or not Decimal(0) <= out['score'] <= out['out_of'] or out['out_of'] > 100000:
            raise ValueError('points range')
    elif kind == 'text':
        text = data.get('result_text', '')
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 60:
            raise ValueError('text result')
        out['result_text'] = text.strip()
    return out


def _n(d):
    d = Decimal(str(d))
    return format(d.quantize(Decimal(1)) if d == d.to_integral() else d.normalize(), 'f')


def describe(entry_like):
    kind = entry_like.get('result_kind')
    if kind == 'percent':
        return f"{_n(entry_like['score'])}%"
    if kind == 'points':
        return f"{_n(entry_like['score'])} / {_n(entry_like['out_of'])}"
    if kind == 'text':
        return entry_like.get('result_text', '')
    return 'not entered'
