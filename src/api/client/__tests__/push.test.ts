import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushEndpointNotAllowedError, sendSubscription } from '../push';

const subscription = {
  toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
} as unknown as PushSubscription;

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('sendSubscription', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns an allowlist refusal into an error that names the host', async () => {
    respond(400, { error: 'endpoint_not_allowed', host: 'push.example' });

    const error = await sendSubscription(subscription, 'en').catch((e) => e);

    expect(error).toBeInstanceOf(PushEndpointNotAllowedError);
    expect(error.host).toBe('push.example');
  });

  it('keeps the generic error for any other failure', async () => {
    respond(400, { error: 'invalid_subscription' });

    const error = await sendSubscription(subscription, 'en').catch((e) => e);

    expect(error).not.toBeInstanceOf(PushEndpointNotAllowedError);
    expect(error.message).toBe('Failed to register subscription');
  });

  it('keeps the generic error when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })));

    const error = await sendSubscription(subscription, 'en').catch((e) => e);

    expect(error.message).toBe('Failed to register subscription');
  });
});
