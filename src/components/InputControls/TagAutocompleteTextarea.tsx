import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  applySuggestion,
  getActiveToken,
  parseToken,
  MIN_TAG_QUERY_LENGTH,
  type Suggestion,
} from '@/utils/autocompleteSearch';
import {
  selectAutocompleteActive,
  useAutocompleteStore,
} from '@/hooks/useAutocompleteStore';
import { getVisualViewportFrame } from '@/hooks/useVisualViewportFrame';

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

/**
 * A multiline text editor with tag/lora/embedding autocomplete layered on top.
 * The autocomplete only activates when the Autocomplete-Plus node is installed
 * and the server opt-in is on; otherwise this behaves as a plain textarea.
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
  const showDropdown = open || loadingVisible;

  // The dropdown is rendered in a portal with fixed positioning anchored to the
  // textarea, so it can't be clipped by an ancestor's overflow — notably the
  // fullscreen prompt modal, which previously cut it to ~2 visible rows. It is
  // positioned against the visual viewport (which shrinks when the on-screen
  // keyboard opens) and flips above the field when there's no room below.
  const [pos, setPos] = useState<{
    left: number; width: number; top?: number; bottom?: number; maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const update = () => {
      const el = textareaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const frame = getVisualViewportFrame();
      const visibleBottom = frame.offsetTop + frame.height;
      const below = visibleBottom - r.bottom - 8;
      const above = r.top - frame.offsetTop - 8;
      const placeAbove = below < 160 && above > below;
      setPos({
        left: r.left,
        width: r.width,
        top: placeAbove ? undefined : r.bottom + 4,
        bottom: placeAbove ? window.innerHeight - r.top + 4 : undefined,
        maxHeight: Math.max(120, Math.min(280, placeAbove ? above : below)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [showDropdown, value, suggestions.length, textareaRef]);

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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown) return;
    // Escape dismisses just the dropdown; stop it from also closing the editor.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActiveIndex(-1);
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
          setActiveIndex(-1);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && pos &&
        createPortal(
          <ul
            // z sits above the fullscreen widget modal (z-[2190]) so the list
            // isn't painted under it, but below the global bottom bar (z-[2200]).
            className="autocomplete-dropdown fixed z-[2195] overflow-auto rounded-md border border-white/10 bg-slate-900 py-1 shadow-xl"
            role="listbox"
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
          >
            {!open && loadingVisible ? (
              <li className="autocomplete-loading px-3 py-2 text-sm text-slate-400">
                Loading tag suggestions…
              </li>
            ) : (
              suggestions.map((suggestion, index) => {
                const isActive = index === activeIndex;
                const color =
                  suggestion.kind === 'tag'
                    ? CATEGORY_COLORS[suggestion.category ?? 0] ?? CATEGORY_COLORS[0]
                    : '#38bdf8';
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
                    <span className="autocomplete-option-label min-w-0 flex-1 truncate">
                      {suggestion.label}
                      {suggestion.matchedAlias && (
                        <span className="autocomplete-option-alias ml-1 text-xs text-slate-400">
                          ({suggestion.matchedAlias})
                        </span>
                      )}
                    </span>
                    {suggestion.count != null && suggestion.count > 0 && (
                      <span className="autocomplete-option-count shrink-0 text-xs text-slate-400">
                        {formatCount(suggestion.count)}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
