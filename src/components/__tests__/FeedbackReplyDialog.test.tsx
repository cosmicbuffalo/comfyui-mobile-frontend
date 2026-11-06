import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackReplyDialog } from '../FeedbackReplyDialog';

vi.mock('@/components/modals/Dialog', () => ({
  Dialog: ({ description, actions }: { description: React.ReactNode; actions: { label: string; onClick: () => void; disabled?: boolean }[] }) => (
    <div role="dialog">{description}{actions.map((a) => <button key={a.label} onClick={a.onClick} disabled={a.disabled}>{a.label}</button>)}</div>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

it('fetches the issue token only when sending and fetches it again on retry', async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: !url.endsWith('/reply'), status: url.endsWith('/reply') ? 503 : 200,
    json: async () => url.endsWith('/reply-token') ? { replyToken: 'one-issue-token' } : { error: 'unavailable' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FeedbackReplyDialog follow={{ number: 7, title: 't', canReply: true, followedAt: 1, seenAt: 1 }} onSent={vi.fn()} onClose={vi.fn()} />));
    expect(fetchMock).not.toHaveBeenCalled();
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'A useful reply for this issue');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const send = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
      await act(async () => send.click());
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/mobile/api/feedback/follows/7/reply-token', expect.stringMatching(/\/reply$/),
      '/mobile/api/feedback/follows/7/reply-token', expect.stringMatching(/\/reply$/),
    ]);
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ number: 7, secret: 'one-issue-token' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
