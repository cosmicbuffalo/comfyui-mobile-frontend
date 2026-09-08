import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

/**
 * How long the app may sit in the background before hidden files hide
 * themselves again, in minutes. `null` is never — the visibility toggle then
 * behaves as it always did and stays on until it is turned off by hand.
 *
 * Measured on time spent AWAY, not time since the toggle was flipped: a
 * timeout counted from switching it on would turn it off mid-session, in front
 * of someone actively looking at the files they just asked for.
 */
export type AutoHideMinutes = number | null;

/** Offered in Preferences, in the order shown. 0 hides on leaving the app. */
export const AUTO_HIDE_MINUTE_CHOICES = [0, 5, 10, 20, 30, 60, 90] as const;
export const DEFAULT_AUTO_HIDE_MINUTES = 5;

interface ShowHiddenState {
  showHidden: boolean;
  autoHideMinutes: AutoHideMinutes;
  /** When the app was last backgrounded, or null while it is on screen. */
  backgroundedAt: number | null;
  /**
   * Last sign of life while the app is ON SCREEN. Not persisted: it describes
   * this visit, and a cold start is settled by `backgroundedAt` instead.
   */
  lastActiveAt: number | null;
  setShowHidden: (showHidden: boolean) => void;
  toggleShowHidden: () => void;
  setAutoHideMinutes: (minutes: AutoHideMinutes) => void;
  /** The app went away. Returns true if that alone hid the files. */
  noteBackgrounded: (at: number) => boolean;
  /** The app came back — or started. Returns true if the wait had run out. */
  noteForegrounded: (at: number) => boolean;
  /** Someone touched the app. Restarts the idle wait. */
  noteActivity: (at: number) => void;
  /**
   * Nothing has happened for a while with the app still on screen. Returns
   * true if that alone hid the files.
   */
  noteIdleCheck: (at: number) => boolean;
}

const SHOW_HIDDEN_STORAGE_KEY = 'show-hidden-storage';

function hasPersistedPreference(): boolean {
  try {
    return localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function readLegacyOutputsPreference(): boolean {
  try {
    const raw = localStorage.getItem('outputs-storage');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { showHidden?: unknown } };
    return parsed.state?.showHidden === true;
  } catch {
    return false;
  }
}

/**
 * localStorage that drops a refused write instead of throwing it. `setItem`
 * raises when the origin is over quota — and unconditionally on an iOS Safari
 * whose private-browsing quota is zero — while this store commits its migrated
 * value at module scope (below). Unguarded, that write would take the whole app
 * down over a decluttering toggle; persistence is the expendable half, so the
 * preference just stays in memory for the session. Same guard the workflow
 * store's backend already uses (`utils/idbStorage`).
 */
function quotaSafeLocalStorage(): StateStorage {
  // Read the property here so a browser that blocks storage outright still
  // throws out of this factory, which is where createJSONStorage catches it and
  // disables persistence for us.
  const storage = localStorage;
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      try {
        storage.setItem(name, value);
      } catch {
        // No room to persist; the in-memory preference still holds.
      }
    },
    removeItem: (name) => storage.removeItem(name),
  };
}

/** One persisted visibility preference shared by every hidden-capable browser. */
const hadPersistedPreference = hasPersistedPreference();
const initialShowHidden = readLegacyOutputsPreference();
export const useShowHiddenStore = create<ShowHiddenState>()(
  persist(
    (set, get) => ({
      // Preserve the old Outputs-only preference on the first upgraded load.
      showHidden: initialShowHidden,
      autoHideMinutes: DEFAULT_AUTO_HIDE_MINUTES,
      backgroundedAt: null,
      lastActiveAt: null,
      // Turning the switch on IS activity, and it has to count as some: the
      // capture listener saw the toggling tap while the switch was still off
      // and ignored it, so without a seed the idle check reads null forever
      // and the flip-it-and-walk-away case never expires.
      setShowHidden: (showHidden) => set({
        showHidden,
        backgroundedAt: null,
        lastActiveAt: showHidden ? Date.now() : null,
      }),
      toggleShowHidden: () => set((state) => ({
        showHidden: !state.showHidden,
        backgroundedAt: null,
        lastActiveAt: state.showHidden ? null : Date.now(),
      })),
      setAutoHideMinutes: (autoHideMinutes) => set({ autoHideMinutes }),
      noteBackgrounded: (at) => {
        const { showHidden, autoHideMinutes, backgroundedAt } = get();
        if (!showHidden || autoHideMinutes === null) return false;
        // iOS fires both visibilitychange and pagehide on the way out, and a
        // second report is the same absence continuing — overwriting the mark
        // would restart the wait every time the app was jostled.
        if (backgroundedAt !== null) return false;
        // A zero wait is "as soon as I leave", so it has to act on the way out
        // rather than on the way back: the app switcher shows a card of the
        // page as it was left, and that card would still be showing the files.
        if (autoHideMinutes === 0) {
          set({ showHidden: false, backgroundedAt: null });
          return true;
        }
        set({ backgroundedAt: at });
        return false;
      },
      noteForegrounded: (at) => {
        const { showHidden, autoHideMinutes, backgroundedAt } = get();
        if (backgroundedAt === null) return false;
        if (!showHidden || autoHideMinutes === null) {
          set({ backgroundedAt: null });
          return false;
        }
        // A clock that went backwards (a device time change, a resumed
        // suspend) reads as a negative wait; treat it as expired rather than
        // letting it hold the files open indefinitely.
        const elapsed = at - backgroundedAt;
        const expired = !(elapsed >= 0) || elapsed >= autoHideMinutes * 60_000;
        set({
          showHidden: expired ? false : showHidden,
          backgroundedAt: null,
          lastActiveAt: at,
        });
        return expired;
      },
      noteActivity: (at) => {
        if (!get().showHidden) return;
        set({ lastActiveAt: at });
      },
      noteIdleCheck: (at) => {
        const { showHidden, autoHideMinutes, lastActiveAt, backgroundedAt } = get();
        // Zero means "as soon as I leave the app", and there is no leaving to
        // detect while it is on screen — applying it to idleness would clear
        // the switch the moment anyone stopped moving.
        if (!showHidden || autoHideMinutes === null || autoHideMinutes === 0) return false;
        // The background wait owns this absence; letting both run would race.
        if (backgroundedAt !== null || lastActiveAt === null) return false;
        const idle = at - lastActiveAt;
        if (!(idle >= 0)) {
          set({ lastActiveAt: at });
          return false;
        }
        if (idle < autoHideMinutes * 60_000) return false;
        set({ showHidden: false, lastActiveAt: null });
        return true;
      },
    }),
    {
      name: SHOW_HIDDEN_STORAGE_KEY,
      storage: createJSONStorage(quotaSafeLocalStorage),
      partialize: (state) => ({
        showHidden: state.showHidden,
        autoHideMinutes: state.autoHideMinutes,
        // Persisted so a cold start is judged the same way a return from the
        // background is: the app being closed IS time spent away.
        backgroundedAt: state.backgroundedAt,
      }),
    },
  ),
);

// Creating a persist store does not write its initial state when no record
// exists. Commit the migrated Outputs-only value now so deleting that legacy
// field cannot lose the preference on the following refresh.
if (!hadPersistedPreference) {
  useShowHiddenStore.getState().setShowHidden(initialShowHidden);
}

// Closing the app is time away too, so a start-up is settled by the same rule
// as a return from the background — using the timestamp the last exit left
// behind. Nothing happens when the app was never backgrounded while showing
// hidden files, which is the ordinary case.
useShowHiddenStore.getState().noteForegrounded(Date.now());
