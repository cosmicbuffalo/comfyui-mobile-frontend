import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPushConfig, sendSubscription, sendTestPush } from '@/api/client/push';
import { usePushNotifications } from '../usePushNotifications';

// A real VAPID key is a base64url-encoded 65-byte EC point; the hook atob()s it,
// so a placeholder that isn't valid base64 throws before it ever subscribes.
const VAPID_KEY =
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';

vi.mock('@/api/client/push', () => ({
  getPushConfig: vi.fn(async () => ({ enabled: true, vapidPublicKey: VAPID_KEY })),
  sendSubscription: vi.fn(async () => undefined),
  removeSubscription: vi.fn(async () => undefined),
  sendTestPush: vi.fn(async () => ({ sent: 1 })),
}));

const mockConfig = vi.mocked(getPushConfig);
const mockSend = vi.mocked(sendSubscription);
const mockTest = vi.mocked(sendTestPush);

let subscription: { endpoint: string; unsubscribe: () => Promise<boolean> } | null = null;
let requestPermissionResult: NotificationPermission = 'granted';
const subscribe = vi.fn(async () => {
  subscription = { endpoint: 'https://push.example/abc', unsubscribe: async () => true };
  return subscription;
});

function installBrowserPushStubs() {
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe,
  };
  const registration = { pushManager };
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      register: vi.fn(async () => registration),
    },
  });
  (globalThis as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (globalThis as unknown as { Notification: unknown }).Notification = Object.assign(
    function Notification() {},
    {
      permission: 'default' as NotificationPermission,
      requestPermission: vi.fn(async () => requestPermissionResult),
    },
  );
}

// Drive the hook through a host component so effects and state settle. The
// snapshot is published from an effect, not during render, so the harness itself
// stays a pure component.
const hook: { current: ReturnType<typeof usePushNotifications> | null } = { current: null };
function Harness() {
  const state = usePushNotifications();
  useEffect(() => {
    hook.current = state;
  });
  return null;
}

describe('usePushNotifications', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    subscription = null;
    requestPermissionResult = 'granted';
    subscribe.mockClear();
    mockConfig.mockReset();
    mockConfig.mockResolvedValue({ enabled: true, vapidPublicKey: VAPID_KEY } as never);
    mockSend.mockReset();
    mockSend.mockResolvedValue({ subscriptions: 1 } as never);
    mockTest.mockReset();
    mockTest.mockResolvedValue({ sent: 1 } as never);
    installBrowserPushStubs();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    hook.current = null;
  });

  it('reports support and no existing subscription', () => {
    expect(hook.current!.supported).toBe(true);
    expect(hook.current!.subscribed).toBe(false);
  });

  it('subscribes and registers with the server when permission is granted', async () => {
    await act(async () => { await hook.current!.enable(); });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/abc' }));
    expect(hook.current!.subscribed).toBe(true);
    expect(hook.current!.error).toBeNull();
  });

  it('explains a blocked permission instead of subscribing', async () => {
    requestPermissionResult = 'denied';

    await act(async () => { await hook.current!.enable(); });

    expect(subscribe).not.toHaveBeenCalled();
    expect(hook.current!.subscribed).toBe(false);
    expect(hook.current!.error).toMatch(/浏览器设置阻止/);
  });

  it('surfaces the server reason when push is unavailable', async () => {
    // pywebpush missing is the common case here, and the user can't fix it from
    // the browser — so the server's own reason has to reach the UI.
    mockConfig.mockResolvedValue({ enabled: false, reason: 'pywebpush is not installed' } as never);

    await act(async () => { await hook.current!.enable(); });

    expect(subscribe).not.toHaveBeenCalled();
    expect(hook.current!.error).toBe('pywebpush is not installed');
  });

  it('does not claim success when the server delivered nothing', async () => {
    mockTest.mockResolvedValue({ sent: 0 } as never);

    await act(async () => { await hook.current!.sendTest(); });

    expect(hook.current!.error).toMatch(/未收到任何通知/);
  });

  it('reports a failed test push', async () => {
    mockTest.mockRejectedValue(new Error('relay unreachable'));

    await act(async () => { await hook.current!.sendTest(); });

    expect(hook.current!.error).toBe('relay unreachable');
  });

  it('unsubscribes both server-side and in the browser', async () => {
    await act(async () => { await hook.current!.enable(); });
    const unsubscribeSpy = vi.spyOn(subscription!, 'unsubscribe');

    await act(async () => { await hook.current!.disable(); });

    expect(unsubscribeSpy).toHaveBeenCalled();
    expect(hook.current!.subscribed).toBe(false);
  });
});
