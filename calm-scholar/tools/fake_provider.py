"""A local stand-in for an OpenAI-compatible endpoint, for integration testing only.

It is NOT an AI. It lets you exercise the real SDK/HTTP path without a key:
    python tools/fake_provider.py 9911
    set OPENAI_API_KEY=fake  &  set OPENAI_BASE_URL=http://127.0.0.1:9911/v1
Messages containing "#429", "#500", "#slow" or "#badjson" trigger those failures.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        LOG.append(body)
        last = body['messages'][-1]['content']
        with open('fake_provider_requests.jsonl', 'a') as f:
            f.write(json.dumps({'model': body.get('model'), 'response_format': body.get('response_format'),
                                'max_completion_tokens': body.get('max_completion_tokens'), 'store': body.get('store'),
                                'n_messages': len(body['messages']), 'auth': self.headers.get('Authorization', '')[:12]}) + '\n')
        if '#429' in last:
            return self._send(429, {'error': {'message': 'rate limited', 'type': 'rate_limit'}})
        if '#500' in last:
            return self._send(500, {'error': {'message': 'boom'}})
        if '#slow' in last:
            time.sleep(40)
        content = 'not json at all' if '#badjson' in last else json.dumps({
            'reply': f'(fake provider) I received {len(body["messages"])} messages. Your latest was {len(last)} characters of JSON.',
            'nuru': 'explaining', 'supported': [], 'proposals': [], 'suggestions': ['Tell me more']})
        self._send(200, {'id': 'x', 'object': 'chat.completion', 'created': 0, 'model': body.get('model'),
                         'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': content}}],
                         'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}})

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 9911), Handler).serve_forever()
