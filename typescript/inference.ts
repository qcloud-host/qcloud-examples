import type QCloud from 'qcloud-ai';

/** Read model IDs and capabilities before choosing a model. This sends no inference request. */
export async function discoverModels(client: QCloud) {
  const catalog = await client.models.list();
  return catalog.data.map(model => ({id: model.id, capabilities: model.capabilities ?? [], pricing: model.pricing}));
}

export async function chat(client: QCloud, model: string, prompt: string) {
  const response = await client.chat.completions.create({
    model, messages: [{role: 'user', content: prompt}], max_tokens: 256,
  });
  return {text: response.choices[0]?.message.content ?? '', usage: response.usage};
}

/** Await the complete stream: partial text alone is not success. Abort closes the connection. */
export async function streamChat(client: QCloud, model: string, prompt: string, onText: (text: string) => void, signal?: AbortSignal) {
  const stream = await client.chat.completions.create({
    model, messages: [{role: 'user', content: prompt}], max_tokens: 256,
    stream: true, stream_options: {include_usage: true},
  }, {signal});
  let usage;
  try {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta.content;
      if (text) onText(text);
      if (chunk.usage) usage = chunk.usage;
    }
    return usage;
  } finally {
    await stream.abort();
  }
}
