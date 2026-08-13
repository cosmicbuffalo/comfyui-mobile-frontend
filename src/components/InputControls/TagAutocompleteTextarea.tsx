import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  applySuggestion,
  getActiveToken,
  getSuggestionWikiUrl,
  parseToken,
  MIN_TAG_QUERY_LENGTH,
  type Suggestion,
} from '@/utils/autocompleteSearch';
import { ExternalLinkIcon, XMarkIcon } from '@/components/icons';
import { useT } from '@/i18n';
import {
  selectAutocompleteActive,
  useAutocompleteStore,
} from '@/hooks/useAutocompleteStore';
import { getVisualViewportFrame } from '@/hooks/useVisualViewportFrame';
import { getCaretCoordinates } from '@/utils/caretCoordinates';
import { computeDropdownPlacement } from '@/utils/dropdownPlacement';

interface TagAutocompleteTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onValueChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}

// Danbooru category index → accent color for the dropdown row dot.
const CATEGORY_COLORS: Record<number, string> = {
  0: '#a0a0b0', // general
  1: '#f87171', // artist
  3: '#c084fc', // copyright
  4: '#4ade80', // character
  5: '#fb923c', // meta
};

function formatCount(count?: number): string {
  if (!count) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

// Grace period after a field gains focus before the autocomplete overlay is
// allowed to appear. This gives the user a beat to see where their caret landed
// before the dropdown covers that spot. It's armed once per focus, so typing in
// an already-open field is not delayed per keystroke.
const AUTOCOMPLETE_OPEN_DELAY_MS = 1000;

/**
 * A multiline text editor with tag/lora/embedding autocomplete layered on top.
 * The autocomplete only activates when a supported source node (Autocomplete-
 * Plus and/or Custom-Scripts) is installed and the server opt-in is on;
 * otherwise this behaves as a plain textarea.
 *
 * `textareaRef` is owned by the caller (used for auto-grow + TextareaActions) and
 * reused here for caret tracking, so no ref merging is needed.
 */
export function TagAutocompleteTextarea({
  textareaRef,
  value,
  onValueChange,
  onBlur,
  placeholder,
  disabled,
  className,
  style,
  autoFocus,
}: TagAutocompleteTextareaProps) {
  const t = useT();
  const active = useAutocompleteStore(selectAutocompleteActive);
  const dataStatus = useAutocompleteStore((s) => s.dataStatus);
  const getSuggestions = useAutocompleteStore((s) => s.getSuggestions);
  const ensureData = useAutocompleteStore((s) => s.ensureData);
  const ensureInitialized = useAutocompleteStore((s) => s.ensureInitialized);

  // Probe availability + read the opt-in once (guarded inside the store), so a
  // text field surfaces autocomplete even before the settings panel is opened.
  useEffect(() => {
    void ensureInitialized();
  }, [ensureInitialized]);

  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  // -1 means "nothing highlighted". We do NOT auto-highlight the first row: in a
  // multiline prompt the user often presses Enter for a newline, and auto-accept
  // would steal that. Enter only accepts once a row is chosen via Arrow keys.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  // Opens AUTOCOMPLETE_OPEN_DELAY_MS after the field gains focus; until then the
  // overlay stays hidden even when suggestions are ready, so the caret stays
  // visible for a beat after the user taps in. Re-armed on every focus.
  const [openDelayPassed, setOpenDelayPassed] = useState(false);
  const pendingCaretRef = useRef<number | null>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  const token = useMemo(() => getActiveToken(value, caret), [value, caret]);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!active || dataStatus !== 'ready') return [];
    return getSuggestions(value, caret).suggestions;
  }, [active, dataStatus, value, caret, getSuggestions]);

  // Whether the current token is worth suggesting against (used to show the
  // loading row only when the user is actually mid-tag, not on an empty field).
  const tokenQualifies = useMemo(() => {
    const parsed = parseToken(token.text);
    return parsed.kind !== 'tag' || parsed.query.trim().length >= MIN_TAG_QUERY_LENGTH;
  }, [token]);

  const open = active && focused && !dismissed && suggestions.length > 0;
  const loadingVisible =
    active && focused && !dismissed && dataStatus === 'loading' && tokenQualifies;
  const showDropdown = (open || loadingVisible) && openDelayPassed;

  // Arm the open-delay grace period on focus (see AUTOCOMPLETE_OPEN_DELAY_MS) and
  // reset it on blur so the next focus gets a fresh beat. The overlay is gated on
  // openDelayPassed above, so nothing shows until the timer fires.
  useEffect(() => {
    if (!focused) return;
    const timer = setTimeout(() => setOpenDelayPassed(true), AUTOCOMPLETE_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focused]);

  // The dropdown is rendered in a portal with fixed positioning, anchored to the
  // caret's line (not the whole textarea) so it appears right under the line
  // being typed. It's measured against the visual viewport (which shrinks when
  // the on-screen keyboard opens) and flips above the caret when there isn't
  // room for ~2 rows below. The portal escapes the fullscreen modal's overflow.
  const [pos, setPos] = useState<{
    left: number; width: number; top?: number; bottom?: number; maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const update = () => {
      const el = textareaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const c = getCaretCoordinates(el, el.selectionStart ?? caret);
      // Viewport y of the caret's line, accounting for any scroll inside the
      // textarea, then let the pure helper decide below-vs-above placement.
      const lineTop = r.top + c.top - el.scrollTop;
      const frame = getVisualViewportFrame();
      setPos(
        computeDropdownPlacement({
          caretLineTop: lineTop,
          caretLineBottom: lineTop + c.height,
          fieldLeft: r.left,
          fieldWidth: r.width,
          viewportTop: frame.offsetTop,
          viewportBottom: frame.offsetTop + frame.height,
          windowHeight: window.innerHeight,
        }),
      );
    };
    update();
    // Scroll/resize can fire many times per frame, and update() lays out a
    // full mirror div to find the caret — coalesce bursts to one per frame.
    let rafId = 0;
    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', scheduleUpdate);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, [showDropdown, value, caret, suggestions.length, textareaRef]);

  // Keep the keyboard-highlighted row visible as it moves past the scroll edge.
  useEffect(() => {
    if (activeIndex >= 0) activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Restore the caret after an accepted suggestion changes the controlled value.
  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const el = textareaRef.current;
    if (!el) return;
    const next = pendingCaretRef.current;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(next, next);
    setCaret(next);
  }, [value, textareaRef]);

  const syncCaret = () => {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  };

  const accept = (suggestion: Suggestion) => {
    const result = applySuggestion(value, token, suggestion);
    pendingCaretRef.current = result.caret;
    setDismissed(true);
    setActiveIndex(-1);
    onValueChange(result.value);
  };

  // Shared by Escape (desktop) and the floating ✕ button (the only dismissal
  // affordance on mobile, where there is no Escape key).
  const dismissDropdown = () => {
    setDismissed(true);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown) return;
    // Escape dismisses just the dropdown; stop it from also closing the editor.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissDropdown();
      return;
    }
    if (!open) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case 'Enter':
        // Only intercept Enter when a row is explicitly highlighted; otherwise
        // let it insert a newline (this is a multiline prompt).
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          event.preventDefault();
          event.stopPropagation();
          accept(suggestions[activeIndex]);
        }
        break;
      case 'Tab': {
        // Tab accepts the highlighted row, or the top one as a shortcut.
        const selected = suggestions[activeIndex >= 0 ? activeIndex : 0];
        if (selected) {
          event.preventDefault();
          event.stopPropagation();
          accept(selected);
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className="autocomplete-field relative">
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        style={style}
        autoFocus={autoFocus}
        data-swipe-nav-ignore="true"
        onChange={(e) => {
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setActiveIndex(-1);
          setDismissed(false);
          onValueChange(e.target.value);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        onFocus={() => {
          setFocused(true);
          if (active) void ensureData();
        }}
        onBlur={() => {
          setFocused(false);
          setOpenDelayPassed(false);
          setActiveIndex(-1);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && pos &&
        createPortal(
          <div
            // z sits above the fullscreen widget modal (z-[2190]) so the list
            // isn't painted under it, but below the global bottom bar (z-[2200]).
            className="autocomplete-dropdown fixed z-[2195] rounded-md border border-white/10 bg-slate-900 shadow-xl"
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
          >
            <button
              type="button"
              aria-label={t("Dismiss autocomplete")}
              className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-slate-800 text-slate-300 shadow-md hover:bg-slate-700 hover:text-white"
              onMouseDown={(e) => {
                // Keep the textarea focused; the tap should only close the list.
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                dismissDropdown();
              }}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
            <ul className="max-h-[inherit] overflow-auto py-1" role="listbox">
            {!open && loadingVisible ? (
              <li className="autocomplete-loading px-3 py-2 text-sm text-slate-400">
                {t("Loading tag suggestions…")}
              </li>
            ) : (
              suggestions.map((suggestion, index) => {
                const isActive = index === activeIndex;
                const color =
                  suggestion.kind === 'tag'
                    ? CATEGORY_COLORS[suggestion.category ?? 0] ?? CATEGORY_COLORS[0]
                    : '#38bdf8';
                // Show the full alias list (parity with the desktop extension),
                // surfacing the matched alias first so the user sees why it hit.
                // The CSV sometimes repeats the canonical tag in its own alias
                // column; drop that redundant entry.
                const aliasList = (suggestion.aliases ?? []).filter(
                  (a) => a.toLowerCase() !== suggestion.label.toLowerCase(),
                );
                const orderedAliases = suggestion.matchedAlias
                  ? [
                      suggestion.matchedAlias,
                      ...aliasList.filter((a) => a !== suggestion.matchedAlias),
                    ]
                  : aliasList;
                const aliasText = orderedAliases.join(', ');
                const wikiUrl = getSuggestionWikiUrl(suggestion);
                return (
                  <li
                    key={`${suggestion.kind}:${suggestion.label}`}
                    ref={isActive ? activeItemRef : undefined}
                    role="option"
                    aria-selected={isActive}
                    className={`autocomplete-option flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                      isActive ? 'bg-slate-700 text-white' : 'text-slate-200'
                    }`}
                    // preventDefault keeps focus on the textarea so onBlur doesn't
                    // fire and close the dropdown before the tap registers.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => accept(suggestion)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span
                      className="autocomplete-option-dot h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="autocomplete-option-label max-w-[55%] shrink-0 truncate">
                      {suggestion.label}
                    </span>
                    {aliasText && (
                      <span
                        className="autocomplete-option-alias min-w-0 flex-1 truncate text-xs text-slate-400"
                        title={aliasText}
                      >
                        {aliasText}
                      </span>
                    )}
                    {!aliasText && <span className="min-w-0 flex-1" />}
                    {wikiUrl && (
                      <a
                        className="autocomplete-option-wiki shrink-0 text-slate-400 hover:text-slate-100"
                        href={wikiUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t("Open the Danbooru wiki page for {label}", { label: suggestion.label })}
                        // Don't let opening the wiki also accept the suggestion;
                        // keep focus on the textarea (preventDefault on mousedown
                        // doesn't block the anchor's click navigation).
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                      >
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {suggestion.count != null && suggestion.count > 0 && (
                      <span className="autocomplete-option-count shrink-0 text-xs text-slate-400">
                        {formatCount(suggestion.count)}
                      </span>
                    )}
                  </li>
                );
              })
            )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
