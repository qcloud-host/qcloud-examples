import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import QCloud, {APIError} from 'qcloud-ai';
import {chat, discoverModels, streamChat} from './inference.js';
import {inspectServices, invokeDedicated, submitGeneration, type GenerationIntent} from './services.js';

const [command = 'help', ...args] = process.argv.slice(2);
const required = (name: string) => {const value = process.env[name]; if (!value) throw new Error(`Set ${name}.`); return value;};
const help = 'Commands: models | chat --run | stream --run | services | init-generation MODEL INPUT_JSON | generation INTENT_FILE --run | job JOB_ID | result JOB_ID | serverless --run';

async function main() {
  if (command === 'help') {console.log(help); return;}
  if (command === 'init-generation') {
    if (!args[0] || !args[1]) throw new Error('Provide a model ID and a JSON input string from its current schema.');
    const input = JSON.parse(args[1], (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON numbers must be finite.');
      return value;
    });
    const intent: GenerationIntent = {client_request_id: randomUUID(), model: args[0], input};
    await writeFile('generation-intent.json', `${JSON.stringify(intent, null, 2)}\n`, {flag: 'wx'});
    console.log('Saved generation-intent.json. Review it and the model price before submission.'); return;
  }
  if (['chat', 'stream', 'generation', 'serverless'].includes(command) && !args.includes('--run')) throw new Error('This command can incur charges. Add --run only after reviewing model access and rates.');
  const config = {apiKey: required('QCLOUD_API_KEY'), baseURL: process.env.QCLOUD_BASE_URL || 'https://platform.qcloud.host/api/v1'};
  const client = new QCloud({...config, maxRetries: 0});
  const prompt = 'Explain vector search in two sentences.';
  switch (command) {
    case 'models': console.log(JSON.stringify(await discoverModels(client), null, 2)); break;
    case 'chat': console.log(await chat(client, required('QCLOUD_MODEL'), prompt)); break;
    case 'stream': {
      const controller = new AbortController();
      const cancel = () => controller.abort(); process.once('SIGINT', cancel);
      try {const usage = await streamChat(client, required('QCLOUD_MODEL'), prompt, text => process.stdout.write(text), controller.signal); console.log('\nUsage:', usage);}
      finally {process.off('SIGINT', cancel);} break;
    }
    case 'services': console.log(JSON.stringify(await inspectServices(client), null, 2)); break;
    case 'generation': {
      const file = args.find(arg => arg !== '--run'); if (!file) throw new Error('Provide the saved intent file.');
      const job = await submitGeneration(client, JSON.parse(await readFile(file, 'utf8')) as GenerationIntent);
      console.log(JSON.stringify(job, null, 2)); break;
    }
    case 'job': console.log(await client.generation.jobs.retrieve(args[0] ?? '')); break;
    case 'result': console.log(await client.generation.jobs.result(args[0] ?? '')); break;
    case 'serverless': console.log(await invokeDedicated(config, required('QCLOUD_DEPLOYMENT_ID'), required('QCLOUD_DEPLOYMENT_MODEL'), prompt)); break;
    default: throw new Error(help);
  }
}
main().catch(error => {
  if (error instanceof APIError) console.error({status: error.status, code: error.code, requestID: error.requestID, message: error.message});
  else console.error(error instanceof Error ? error.message : 'Example failed.');
  process.exitCode = 1;
});
