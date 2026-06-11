import { describe, expect, it } from 'vitest';
import { buildReenqueueRequest } from '../queueReenqueue';

describe('buildReenqueueRequest', () => {
  it('reuses the original prompt payload and routes it to the current client', () => {
    const prompt = { '1': { class_type: 'Sampler', inputs: { seed: 42 } } };
    const extraData = { extra_pnginfo: { workflow: { nodes: [] } }, custom: 'unchanged' };

    const request = buildReenqueueRequest({
      prompt,
      client_id: 'old-client',
      extra_data: extraData,
    }, 'current-client');

    expect(request).toEqual({
      prompt,
      client_id: 'current-client',
      extra_data: extraData,
    });
    expect(request.prompt).toBe(prompt);
    expect(request.extra_data).toBe(extraData);
  });
});
