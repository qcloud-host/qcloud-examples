import json
import os
import subprocess
import sys
from pathlib import Path
import unittest

import httpx
from qcloud_ai import QCloud, QCloudAIError
from qcloud_examples.inference import chat, discover_models, stream_chat
from qcloud_examples.services import inspect_services, invoke_dedicated, submit_generation

FIXTURES = json.loads((Path(__file__).resolve().parents[2] / 'tests' / 'fixtures.json').read_text(encoding='utf-8'))
BASE = 'https://offline.invalid/api/v1'
KEY = 'qc_test_offline_only'
INTENT = {'client_request_id': FIXTURES['requestId'], 'model': FIXTURES['generationModel']['id'], 'input': {'prompt': 'A quiet observatory'}}
ENABLED = {**FIXTURES['generationModel'], 'available': True, 'queued_available': True}


class ExamplesTests(unittest.TestCase):
    def harness(self, reply):
        calls = []
        def handler(request):
            self.assertEqual(request.url.host, 'offline.invalid')
            self.assertEqual(request.headers['authorization'], f'Bearer {KEY}')
            call = {'path': request.url.path, 'method': request.method,
                    'body': json.loads(request.content) if request.content else None}
            calls.append(call)
            return reply(call)
        transport = httpx.Client(transport=httpx.MockTransport(handler))
        client = QCloud(api_key=KEY, base_url=BASE, max_retries=0, http_client=transport)
        self.addCleanup(client.close)
        return client, calls, transport

    def stream_response(self, done=True):
        chunk = {'id': 'chatcmpl-offline', 'object': 'chat.completion.chunk', 'created': 1, 'model': FIXTURES['model']}
        events = [
            {**chunk, 'choices': [{'index': 0, 'delta': {'content': 'Hello, κόσμε.'}, 'finish_reason': None}]},
            {**chunk, 'choices': [], 'usage': FIXTURES['completion']['usage']},
        ]
        text = ''.join(f'data: {json.dumps(event)}\n\n' for event in events)
        if done:
            text += 'data: [DONE]\n\n'
        return httpx.Response(200, text=text, headers={'content-type': 'text/event-stream'})

    def test_discovery_is_read_only(self):
        client, calls, _ = self.harness(lambda call: httpx.Response(200, json=FIXTURES['models']))
        models = discover_models(client)
        self.assertEqual(models[0]['id'], FIXTURES['model'])
        self.assertEqual(models[0]['capabilities'], ['chat'])
        self.assertEqual([(call['method'], call['path']) for call in calls], [('GET', '/api/v1/models')])

    def test_chat_request_and_usage(self):
        client, calls, _ = self.harness(lambda call: httpx.Response(200, json=FIXTURES['completion']))
        result = chat(client, FIXTURES['model'], 'Explain vectors.')
        self.assertEqual(result['text'], 'Hello, κόσμε.')
        self.assertEqual(result['usage'].total_tokens, 5)
        self.assertEqual(calls[0]['body'], {'model': FIXTURES['model'], 'messages': [{'role': 'user', 'content': 'Explain vectors.'}], 'max_tokens': 256})

    def test_stream_complete(self):
        client, calls, _ = self.harness(lambda call: self.stream_response())
        text = []
        usage = stream_chat(client, FIXTURES['model'], 'Hi', text.append)
        self.assertEqual(''.join(text), 'Hello, κόσμε.')
        self.assertEqual(usage.total_tokens, 5)
        self.assertTrue(calls[0]['body']['stream'])
        self.assertEqual(calls[0]['body']['stream_options'], {'include_usage': True})

    def test_truncated_stream_is_not_success(self):
        client, calls, _ = self.harness(lambda call: self.stream_response(False))
        text = []
        with self.assertRaises(QCloudAIError):
            stream_chat(client, FIXTURES['model'], 'Hi', text.append)
        self.assertEqual(''.join(text), 'Hello, κόσμε.')
        self.assertEqual(len(calls), 1)

    def test_disabled_or_stale_generation_never_submits(self):
        for model in [FIXTURES['generationModel'], {**ENABLED, 'reference_stale': True}, {**ENABLED, 'reference_status': None}]:
            with self.subTest(model=model):
                client, calls, _ = self.harness(lambda call: httpx.Response(200, json=model))
                with self.assertRaisesRegex(RuntimeError, 'No job was submitted'):
                    submit_generation(client, INTENT)
                self.assertEqual([call['method'] for call in calls], ['GET'])

    def test_generation_preserves_intent(self):
        client, calls, _ = self.harness(lambda call: httpx.Response(200, json=ENABLED if call['method'] == 'GET' else FIXTURES['generationJob']))
        job = submit_generation(client, INTENT)
        self.assertEqual(job.id, FIXTURES['generationJob']['data']['id'])
        self.assertEqual(calls[1]['path'], '/api/v1/generation/jobs')
        self.assertEqual(calls[1]['body'], {**INTENT, 'billing_mode': 'metered'})

    def test_generation_failure_never_auto_resubmits(self):
        client, calls, _ = self.harness(lambda call: httpx.Response(200, json=ENABLED) if call['method'] == 'GET' else httpx.Response(503, json={'error': {'message': 'Unavailable', 'code': 'upstream_error'}}))
        with self.assertRaises(QCloudAIError) as caught:
            submit_generation(client, INTENT)
        self.assertEqual(caught.exception.client_request_id, INTENT['client_request_id'])
        self.assertEqual(len([call for call in calls if call['method'] == 'POST']), 1)

    def test_service_discovery_is_inactive_and_read_only(self):
        routes = {'/api/v1/generation/models': FIXTURES['generationList'], '/api/v1/serverless/queue/catalog': FIXTURES['queueCatalog'], '/api/v1/serverless/queue/runtime/capabilities': FIXTURES['queueCapabilities']}
        client, calls, _ = self.harness(lambda call: httpx.Response(200, json=routes[call['path']]))
        result = inspect_services(client)
        self.assertIs(result['queue_runtime']['execution_available'], False)
        self.assertEqual([call['method'] for call in calls], ['GET', 'GET', 'GET'])

    def test_cold_dedicated_endpoint_never_invokes(self):
        _, calls, transport = self.harness(lambda call: httpx.Response(503, json={'ready': False}))
        with self.assertRaisesRegex(RuntimeError, 'No inference request'):
            invoke_dedicated(KEY, BASE, FIXTURES['deploymentId'], FIXTURES['model'], 'Hi', transport)
        self.assertEqual([(call['method'], call['path']) for call in calls], [('GET', f"/api/v1/serverless/{FIXTURES['deploymentId']}/health")])

    def test_ready_dedicated_endpoint_has_no_second_v1(self):
        _, calls, transport = self.harness(lambda call: httpx.Response(200, json={'ready': True} if call['method'] == 'GET' else FIXTURES['completion']))
        invoke_dedicated(KEY, BASE, FIXTURES['deploymentId'], FIXTURES['model'], 'Hi', transport)
        self.assertEqual(calls[1]['path'], f"/api/v1/serverless/{FIXTURES['deploymentId']}/chat/completions")
        self.assertEqual([call['method'] for call in calls], ['GET', 'POST'])

    def test_cli_requires_explicit_execution_before_credentials(self):
        root = Path(__file__).resolve().parents[2]
        for command in ['chat', 'stream', 'generation', 'serverless']:
            args = [sys.executable, '-m', 'qcloud_examples', command]
            if command == 'generation':
                args.append('saved-intent.json')
            result = subprocess.run(args, cwd=root, env={**os.environ, 'PYTHONPATH': str(root / 'python'), 'QCLOUD_API_KEY': '', 'QCLOUD_BASE_URL': BASE}, text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn('Add --run', result.stderr)


if __name__ == '__main__':
    unittest.main()
