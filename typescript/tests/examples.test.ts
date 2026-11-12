import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import QCloud from 'qcloud-ai';
import {chat, discoverModels, streamChat} from '../inference.js';
import {inspectServices, invokeDedicated, submitGeneration} from '../services.js';

const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures.json', import.meta.url), 'utf8'));
const baseURL = 'https://offline.invalid/api/v1';
const apiKey = 'qc_test_offline_only';
type Call = {path: string; method: string; body: Record<string, unknown> | null};
function harness(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, 'https://offline.invalid');
    assert.equal(request.headers.get('authorization'), `Bearer ${apiKey}`);
    const body = await request.text();
    const call = {path: new URL(request.url).pathname, method: request.method, body: body ? JSON.parse(body) : null};
    calls.push(call);
    return reply(call);
  };
  return {calls, fetcher, client: new QCloud({apiKey, baseURL, fetch: fetcher, maxRetries: 0})};
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
const intent = {client_request_id: fixtures.requestId, model: fixtures.generationModel.id, input: {prompt: 'A quiet observatory'}};
const enabledModel = {...fixtures.generationModel, available: true, queued_available: true};
function sse(done = true) {
  const chunk = {id: 'chatcmpl-offline', object: 'chat.completion.chunk', created: 1, model: fixtures.model};
  return new Response([
    `data: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {content: 'Hello, κόσμε.'}, finish_reason: null}]})}\n\n`,
    `data: ${JSON.stringify({...chunk, choices: [], usage: fixtures.completion.usage})}\n\n`,
    done ? 'data: [DONE]\n\n' : '',
  ].join(''), {headers: {'content-type': 'text/event-stream'}});
}

test('discovery reads exact IDs without an inference request', async () => {
  const h = harness(call => { assert.equal(call.path, '/api/v1/models'); return json(fixtures.models); });
  const models = await discoverModels(h.client);
  assert.equal(models[0].id, fixtures.model);
  assert.deepEqual(models[0].capabilities, ['chat']);
  assert.deepEqual(h.calls.map(call => call.method), ['GET']);
});

test('chat preserves model and prompt, bounds requested tokens and returns usage', async () => {
  const h = harness(call => { assert.equal(call.path, '/api/v1/chat/completions'); return json(fixtures.completion); });
  const response = await chat(h.client, fixtures.model, 'Explain vectors.');
  assert.equal(response.text, 'Hello, κόσμε.');
  assert.equal(response.usage?.total_tokens, 5);
  assert.deepEqual(h.calls[0].body, {model: fixtures.model, messages: [{role: 'user', content: 'Explain vectors.'}], max_tokens: 256});
});

test('streaming completes with Unicode text and final usage', async () => {
  const h = harness(() => sse());
  let text = '';
  const usage = await streamChat(h.client, fixtures.model, 'Hi', delta => { text += delta; });
  assert.equal(text, 'Hello, κόσμε.');
  assert.equal(usage?.total_tokens, 5);
  assert.equal(h.calls[0].body?.stream, true);
  assert.deepEqual(h.calls[0].body?.stream_options, {include_usage: true});
});

test('partial text from a truncated stream is not reported as success', async () => {
  const h = harness(() => sse(false));
  let text = '';
  await assert.rejects(streamChat(h.client, fixtures.model, 'Hi', delta => { text += delta; }), /stream|done|end/i);
  assert.equal(text, 'Hello, κόσμε.');
  assert.equal(h.calls.length, 1);
});

test('a disabled or stale model never submits a generation job', async () => {
  for (const model of [fixtures.generationModel, {...enabledModel, reference_stale: true}, {...enabledModel, reference_status: undefined}]) {
    const h = harness(call => { assert.equal(call.method, 'GET'); return json(model); });
    await assert.rejects(submitGeneration(h.client, intent), /No job was submitted/);
    assert.equal(h.calls.length, 1);
  }
});

test('enabled generation preserves the saved intent and explicit billing acceptance', async () => {
  const h = harness(call => call.method === 'GET' ? json(enabledModel) : json(fixtures.generationJob));
  const job = await submitGeneration(h.client, intent);
  assert.equal(job.id, fixtures.generationJob.data.id);
  assert.equal(h.calls[1].path, '/api/v1/generation/jobs');
  assert.deepEqual(h.calls[1].body, {...intent, billing_mode: 'metered'});
});

test('an ambiguous generation failure is surfaced without automatic resubmission', async () => {
  const h = harness(call => call.method === 'GET' ? json(enabledModel) : json({error: {message: 'Unavailable', code: 'upstream_error'}}, 503));
  await assert.rejects(submitGeneration(h.client, intent), error => typeof error === 'object' && error !== null && 'clientRequestId' in error && error.clientRequestId === intent.client_request_id);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
});

test('service discovery preserves inactive queue capabilities and sends only reads', async () => {
  const routes: Record<string, unknown> = {
    '/api/v1/generation/models': fixtures.generationList,
    '/api/v1/serverless/queue/catalog': fixtures.queueCatalog,
    '/api/v1/serverless/queue/runtime/capabilities': fixtures.queueCapabilities,
  };
  const h = harness(call => { assert.ok(call.path in routes, `Unexpected ${call.path}`); return json(routes[call.path]); });
  const services = await inspectServices(h.client);
  assert.equal(services.queueRuntime.execution_available, false);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'GET', 'GET']);
});

test('cold dedicated endpoint receives health read only', async () => {
  const h = harness(call => { assert.equal(call.path, `/api/v1/serverless/${fixtures.deploymentId}/health`); return json({ready: false}, 503); });
  await assert.rejects(invokeDedicated({apiKey, baseURL}, fixtures.deploymentId, fixtures.model, 'Hi', h.fetcher), /No inference request/);
  assert.deepEqual(h.calls.map(call => call.method), ['GET']);
});

test('ready dedicated endpoint uses the invocation base without a second v1', async () => {
  const h = harness(call => call.method === 'GET' ? json({ready: true}) : json(fixtures.completion));
  await invokeDedicated({apiKey, baseURL}, fixtures.deploymentId, fixtures.model, 'Hi', h.fetcher);
  assert.equal(h.calls[1].path, `/api/v1/serverless/${fixtures.deploymentId}/chat/completions`);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
});

test('CLI invocation commands require explicit execution before reading credentials', () => {
  for (const command of ['chat', 'stream', 'generation', 'serverless']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'typescript/run.ts', command], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {...process.env, QCLOUD_API_KEY: '', QCLOUD_BASE_URL: baseURL},
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Add --run/);
  }
});
