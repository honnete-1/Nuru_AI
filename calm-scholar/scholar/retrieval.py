"""Small SQLite-friendly retrieval layer.

Materials are split into page-aware passages at upload time. A question is
scored against the student's own passages with a compact BM25 implementation.
Only the best few passages are sent to the model, and every citation the
interface shows is a real Passage row (id, page, exact text).
"""
import math
import re
from collections import Counter

PASSAGE_CHARS = 700
MIN_PARAGRAPH = 160  # shorter paragraphs are merged with their neighbour
MAX_PASSAGES_PER_MATERIAL = 600
STOP = set('a an the and or of to in on for is are was were be been it this that with as by at from into your you i we our their they he she them his her its not no but if then so do does did can could should would will may might what which who how why when where there here than about over under also just more most such these those any some each per via'.split())


def tokens(text):
    return [t for t in re.findall(r"[a-z0-9][a-z0-9'\-]*", text.lower()) if t not in STOP and len(t) > 1]


def chunk_page(text, page=None):
    """Split one page of text into readable passages on paragraph/sentence boundaries."""
    text = re.sub(r'[ \t]+', ' ', text.replace('\r', '')).strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    chunks, current = [], ''
    for para in paragraphs:
        para = re.sub(r'\s*\n\s*', ' ', para)
        while len(para) > PASSAGE_CHARS:
            cut = para.rfind('. ', 0, PASSAGE_CHARS)
            cut = cut + 1 if cut > PASSAGE_CHARS // 3 else PASSAGE_CHARS
            if current:
                chunks.append(current)
                current = ''
            chunks.append(para[:cut].strip())
            para = para[cut:].strip()
        if current and (len(current) >= MIN_PARAGRAPH or len(current) + len(para) + 1 > PASSAGE_CHARS):
            chunks.append(current)
            current = para
        else:
            current = f'{current}\n{para}'.strip()
    if current:
        chunks.append(current)
    return [(page, c) for c in chunks if len(c) >= 20]


class ExtractionError(Exception):
    """Raised with a student-friendly explanation."""


def extract(kind, data):
    """Return a list of (page, text) chunks. Raises ExtractionError on failure."""
    if kind == 'txt' or kind == 'note':
        try:
            text = data.decode('utf-8') if isinstance(data, bytes) else data
        except UnicodeDecodeError:
            try:
                text = data.decode('cp1252')
            except UnicodeDecodeError:
                raise ExtractionError('This text file uses an encoding we could not read. Save it as UTF-8 and upload again.')
        if '\x00' in text:
            raise ExtractionError('This does not look like a plain-text file.')
        return chunk_page(text)
    if kind == 'pdf':
        import io
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ExtractionError('This PDF is password-protected. Remove the password, or paste the text as a note.')
            chunks = []
            for number, page in enumerate(reader.pages, start=1):
                if number > 300:
                    break
                try:
                    chunks.extend(chunk_page(page.extract_text() or '', page=number))
                except Exception:
                    continue
            return chunks
        except ExtractionError:
            raise
        except (PdfReadError, ValueError, KeyError, TypeError, OSError):
            raise ExtractionError('We could not open this PDF. It may be damaged. Try exporting it again, or paste the key text as a note.')
    raise ExtractionError('Only PDF and TXT files are supported.')


def search(user, query, material_ids=None, course_id=None, limit=4):
    """Return up to `limit` (passage, score) pairs from this student's materials."""
    from .models import Passage
    q = tokens(query)
    if not q:
        return []
    qs = Passage.objects.filter(user=user, material__status='ready').select_related('material')
    if material_ids:
        qs = qs.filter(material_id__in=material_ids)
    elif course_id:
        qs = qs.filter(material__course_id=course_id)
    passages = list(qs[:4000])
    if not passages:
        return []
    docs = [tokens(p.text) for p in passages]
    n = len(docs)
    avg = sum(len(d) for d in docs) / n or 1
    df = Counter()
    for d in docs:
        df.update(set(d))
    qcount = Counter(q)
    scored = []
    for p, d in zip(passages, docs):
        tf = Counter(d)
        score = 0.0
        for term, weight in qcount.items():
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            f = tf[term]
            score += weight * idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len(d) / avg))
        if score > 0:
            scored.append((p, score))
    scored.sort(key=lambda x: -x[1])
    if not scored:
        return []
    # Ignore weak matches: a single common word should not count as "your notes say".
    best = scored[0][1]
    matched_terms = lambda p: len(set(tokens(p.text)) & set(q))
    floor = 1 if len(set(q)) == 1 else 2
    return [(p, s) for p, s in scored[:limit] if s >= best * 0.35 and matched_terms(p) >= min(floor, len(set(q)))]


def cite(passage):
    return {
        'id': passage.id,
        'material_id': passage.material_id,
        'material': passage.material.title,
        'page': passage.page,
        'excerpt': passage.text[:420] + ('…' if len(passage.text) > 420 else ''),
    }
