import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_HIDE_MINUTE_CHOICES,
  DEFAULT_AUTO_HIDE_MINUTES,
  useShowHiddenStore,
} from '@/hooks/useShowHidden';

const MINUTE = 60_000;
const START = 1_700_000_000_000;

const state = () => useShowHiddenStore.getState();

describe('re-hiding hidden files after time away', () => {
  beforeEach(() => {
    useShowHiddenStore.setState({
      showHidden: true,
      autoHideMinutes: DEFAULT_AUTO_HIDE_MINUTES,
      backgroundedAt: null,
      lastActiveAt: START,
    });
  });

  it('offers the documented waits and defaults to five minutes', () => {
    expect(AUTO_HIDE_MINUTE_CHOICES).toEqual([0, 5, 10, 20, 30, 60, 90]);
    expect(DEFAULT_AUTO_HIDE_MINUTES).toBe(5);
  });

  it('keeps the files showing when the app comes back inside the wait', () => {
    state().noteBackgrounded(START);
    expect(state().showHidden).toBe(true);

    expect(state().noteForegrounded(START + 4 * MINUTE)).toBe(false);
    expect(state().showHidden).toBe(true);
    // The wait is spent; a later return starts from nothing rather than
    // carrying the old timestamp forward.
    expect(state().backgroundedAt).toBeNull();
  });

  it('hides them once the wait is up', () => {
    state().noteBackgrounded(START);
    expect(state().noteForegrounded(START + 5 * MINUTE)).toBe(true);
    expect(state().showHidden).toBe(false);
  });

  it('hides them on the way out when the wait is zero', () => {
    useShowHiddenStore.setState({ autoHideMinutes: 0 });
    // Acting on return would leave the app-switcher card showing the files.
    expect(state().noteBackgrounded(START)).toBe(true);
    expect(state().showHidden).toBe(false);
    expect(state().backgroundedAt).toBeNull();
  });

  it('never touches them when the preference is off', () => {
    useShowHiddenStore.setState({ autoHideMinutes: null });
    state().noteBackgrounded(START);
    expect(state().backgroundedAt).toBeNull();

    expect(state().noteForegrounded(START + 24 * 60 * MINUTE)).toBe(false);
    expect(state().showHidden).toBe(true);
  });

  it('does nothing while hidden files are not being shown', () => {
    useShowHiddenStore.setState({ showHidden: false });
    expect(state().noteBackgrounded(START)).toBe(false);
    expect(state().backgroundedAt).toBeNull();
    expect(state().showHidden).toBe(false);
  });

  it('treats a clock that went backwards as an expired wait', () => {
    state().noteBackgrounded(START);
    // A device time change or a resumed suspend can hand back an earlier
    // instant; holding the files open on that reading is the wrong way to fail.
    expect(state().noteForegrounded(START - 60 * MINUTE)).toBe(true);
    expect(state().showHidden).toBe(false);
  });

  it('drops a pending wait when the switch is used by hand', () => {
    state().noteBackgrounded(START);
    state().toggleShowHidden();
    expect(state().showHidden).toBe(false);
    expect(state().backgroundedAt).toBeNull();

    state().setShowHidden(true);
    // Turning it back on starts the clock over rather than inheriting the wait
    // that was already running when it went off.
    expect(state().backgroundedAt).toBeNull();
    expect(state().noteForegrounded(START + 90 * MINUTE)).toBe(false);
    expect(state().showHidden).toBe(true);
  });

  it('counts a second report of leaving as part of the same absence', () => {
    // visibilitychange and pagehide both fire on iOS; the later one must not
    // restart the wait.
    state().noteBackgrounded(START);
    state().noteBackgrounded(START + 3 * MINUTE);
    expect(state().noteForegrounded(START + 5 * MINUTE)).toBe(true);
  });

  describe('left open but untouched', () => {
    it('hides them once the tab has sat idle for the wait', () => {
      // A desktop tab on the outputs page fires no visibility event at all, so
      // the away path never sees it.
      expect(state().noteIdleCheck(START + 4 * MINUTE)).toBe(false);
      expect(state().showHidden).toBe(true);

      expect(state().noteIdleCheck(START + 5 * MINUTE)).toBe(true);
      expect(state().showHidden).toBe(false);
    });

    it('restarts the wait on any sign of life', () => {
      state().noteActivity(START + 4 * MINUTE);
      expect(state().noteIdleCheck(START + 8 * MINUTE)).toBe(false);
      expect(state().showHidden).toBe(true);

      expect(state().noteIdleCheck(START + 9 * MINUTE)).toBe(true);
    });

    it('leaves a zero wait to the away path alone', () => {
      useShowHiddenStore.setState({ autoHideMinutes: 0 });
      // Zero means "as soon as I leave". Read as idleness it would clear the
      // switch the moment anyone stopped moving the mouse.
      expect(state().noteIdleCheck(START + 60 * MINUTE)).toBe(false);
      expect(state().showHidden).toBe(true);
    });

    it('does not run while the app is away', () => {
      state().noteBackgrounded(START);
      // The away wait owns this absence; both running would race to hide it.
      expect(state().noteIdleCheck(START + 90 * MINUTE)).toBe(false);
      expect(state().showHidden).toBe(true);
    });

    it('never touches them when the preference is off', () => {
      useShowHiddenStore.setState({ autoHideMinutes: null });
      expect(state().noteIdleCheck(START + 24 * 60 * MINUTE)).toBe(false);
      expect(state().showHidden).toBe(true);
    });

    it('arms the idle wait the moment the switch is turned on', () => {
      // The toggling tap is the last interaction: the capture listener saw it
      // while the switch was still off and ignored it, so the toggle itself
      // has to count as the first activity or a flip-and-walk-away never
      // expires.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(START);
        useShowHiddenStore.setState({ showHidden: false, lastActiveAt: null });
        state().toggleShowHidden();
        expect(state().lastActiveAt).toBe(START);
        expect(state().noteIdleCheck(START + 5 * MINUTE)).toBe(true);
        expect(state().showHidden).toBe(false);

        useShowHiddenStore.setState({ showHidden: false, lastActiveAt: null });
        state().setShowHidden(true);
        expect(state().lastActiveAt).toBe(START);
        // Turning it off leaves nothing armed.
        state().setShowHidden(false);
        expect(state().lastActiveAt).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('starts the idle wait over when the app comes back', () => {
      state().noteBackgrounded(START);
      state().noteForegrounded(START + 1 * MINUTE);
      expect(state().showHidden, 'came back inside the wait').toBe(true);
      // Time spent away is not time spent idle in front of someone.
      expect(state().noteIdleCheck(START + 5 * MINUTE)).toBe(false);
      expect(state().noteIdleCheck(START + 6 * MINUTE)).toBe(true);
    });
  });
});
