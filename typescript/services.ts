import QCloud, {type JSONValue} from 'qcloud-ai';

export type GenerationIntent = {client_request_id: string; model: string; input: JSONValue};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Discovery only. Missing permission or unavailable services fail explicitly. */
export async function inspectServices(client: QCloud) {
  return {
    generation: await client.generation.models.list({limit: 10}),
    queueCatalog: await client.serverless.queue.catalog(),
    queueRuntime: await client.serverless.queue.runtime.capabilities(),
  };
}

/** Pass an intent saved before sending. Never generate a replacement UUID after a timeout. */
export async function submitGeneration(client: QCloud, intent: GenerationIntent) {
  if (!uuid.test(intent.client_request_id) || !intent.model || intent.input === undefined) throw new Error('A saved UUID, model and JSON input are required.');
  const model = await client.generation.models.retrieve(intent.model);
  if (model.queued_available !== true || model.schema_available !== true || model.reference_status !== 'current' || model.reference_stale !== false) {
    throw new Error('This model is not available for queued execution. No job was submitted.');
  }
  return client.generation.jobs.submit({...intent, billing_mode: 'metered'});
}

/** Readiness is checked without waking a worker; a false result must not dispatch inference. */
export async function invokeDedicated(config: {apiKey: string; baseURL: string}, deploymentId: string, model: string, prompt: string, fetcher: typeof fetch = fetch) {
  if (!uuid.test(deploymentId) || !model) throw new Error('Use an enabled deployment UUID and its exact pinned model.');
  const client = new QCloud({...config, baseURL: `${config.baseURL.replace(/\/$/, '')}/serverless/${deploymentId}`, maxRetries: 0, fetch: fetcher});
  const response = await fetcher(`${client.baseURL}/health`, {headers: {Authorization: `Bearer ${config.apiKey}`}, redirect: 'error', signal: AbortSignal.timeout(120_000)});
  if (!response.ok || (await response.json() as {ready?: boolean}).ready !== true) throw new Error('The deployment is not ready. No inference request was sent.');
  return client.chat.completions.create({model, messages: [{role: 'user', content: prompt}], max_tokens: 256});
}
