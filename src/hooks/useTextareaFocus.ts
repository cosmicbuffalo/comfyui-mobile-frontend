import { useEffect, useRef, useState } from 'react';
import { debugLog } from '@/utils/debugLog';

function scrollTextareaIntoView(
  target: HTMLTextAreaElement,
  behavior: ScrollBehavior,
  reason: string
) {
  const header = target.closest('[data-textarea-root]')?.querySelector('[data-textarea-header]') as HTMLElement | null;
  const rootStyle = getComputedStyle(document.documentElement);
  const topBarOffset = parseFloat(rootStyle.getPropertyValue('--top-bar-offset')) || 0;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const layoutTopEdge = topBarOffset + 8;
  const scrollContainer = getScrollContainer(target);
  const headerRect = header?.getBoundingClientRect();
  const containerInfo = scrollContainer === window
    ? { type: 'window', scrollY: window.scrollY }
    : (() => {
        const element = scrollContainer as HTMLElement;
        return {
          type: 'element',
          tag: element.tagName.toLowerCase(),
          scrollTop: element.scrollTop,
          height: element.clientHeight
        };
      })();
  debugLog('textarea-scroll: start', {
    reason,
    behavior,
    headerTop: headerRect?.top ?? null,
    layoutTopEdge,
    viewportTopEdge: viewportTop + topBarOffset + 8,
    viewportTop,
    viewportHeight,
    topBarOffset,
    container: containerInfo,
    selectionStart: target.selectionStart
  });
  const caretTop = getTextareaCaretTop(target);
  const targetTop = viewportTop + topBarOffset + viewportHeight * 0.25;
  const visibilityBottom = viewportTop + viewportHeight - 24;
  const deltaHeader = headerRect ? headerRect.top - layoutTopEdge : null;
  const deltaCaret = caretTop - targetTop;
  const deltaCaretMin = caretTop > visibilityBottom ? caretTop - visibilityBottom : 0;
  let delta = 0;
  const canAlignHeader = deltaHeader !== null && deltaHeader > 2;
  const caretAfterHeader = canAlignHeader ? caretTop - deltaHeader : caretTop;
  const caretVisibleAfterHeader = caretAfterHeader <= visibilityBottom;

  if (canAlignHeader && caretVisibleAfterHeader) {
    delta = deltaHeader ?? 0;
  } else if (!canAlignHeader && caretTop <= visibilityBottom) {
    delta = 0;
  } else {
    delta = deltaCaret;
    if (deltaCaretMin > delta) {
      delta = deltaCaretMin;
    }
  }

  if (delta < 0) delta = 0;
  if (headerRect && deltaHeader !== null && headerRect.top > layoutTopEdge + 2 && delta > deltaHeader) {
    delta = deltaHeader;
  }

  debugLog('textarea-scroll: align', {
    caretTop,
    targetTop,
    visibilityBottom,
    deltaHeader,
    deltaCaret,
    deltaCaretMin,
    caretAfterHeader,
    caretVisibleAfterHeader,
    canAlignHeader,
    delta
  });

  if (Math.abs(delta) > 8) {
    scrollByDelta(scrollContainer, delta, behavior);
  }
}

function alignTextareaHeader(textarea: HTMLTextAreaElement) {
  const header = textarea.closest('[data-textarea-root]')?.querySelector('[data-textarea-header]') as HTMLElement | null;
  if (!header) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const topBarOffset = parseFloat(rootStyle.getPropertyValue('--top-bar-offset')) || 0;
  const layoutTopEdge = topBarOffset + 8;
  const headerRect = header.getBoundingClientRect();
  const delta = headerRect.top - layoutTopEdge;
  if (Math.abs(delta) < 2) return;
  const scrollContainer = getScrollContainer(textarea);
  debugLog('textarea-scroll: align-header-request', {
    headerTop: headerRect.top,
    layoutTopEdge,
    delta
  });
  scrollByDelta(scrollContainer, delta, 'auto');
}

function getTextareaCaretTop(textarea: HTMLTextAreaElement) {
  const rect = textarea.getBoundingClientRect();
  const caretOffset = getCaretOffsetInTextarea(textarea);
  return rect.top + caretOffset - textarea.scrollTop;
}

function getCaretOffsetInTextarea(textarea: HTMLTextAreaElement) {
  const selectionStart = textarea.selectionStart ?? 0;
  const value = textarea.value;
  const mirror = document.createElement('div');
  const style = getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.top = '0';
  mirrorStyle.left = '-9999px';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.wordWrap = 'break-word';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.boxSizing = style.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.padding = style.padding;
  mirrorStyle.border = style.border;
  mirrorStyle.fontFamily = style.fontFamily;
  mirrorStyle.fontSize = style.fontSize;
  mirrorStyle.fontWeight = style.fontWeight;
  mirrorStyle.fontStyle = style.fontStyle;
  mirrorStyle.letterSpacing = style.letterSpacing;
  mirrorStyle.lineHeight = style.lineHeight;
  mirrorStyle.textTransform = style.textTransform;
  mirrorStyle.textIndent = style.textIndent;
  mirrorStyle.tabSize = style.tabSize;

  const before = document.createTextNode(value.slice(0, selectionStart));
  const marker = document.createElement('span');
  marker.textContent = value.slice(selectionStart, selectionStart + 1) || ' ';
  marker.style.display = 'inline-block';
  marker.style.width = '1px';

  mirror.appendChild(before);
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const offset = markerRect.top - mirrorRect.top;
  document.body.removeChild(mirror);
  return offset;
}

function setTextareaFocusState(active: boolean) {
  if (active) {
    document.body.dataset.textareaFocus = 'true';
  } else {
    delete document.body.dataset.textareaFocus;
  }
}

function getScrollContainer(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null;
  while (current) {
    const style = getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}

function scrollByDelta(container: HTMLElement | Window, delta: number, behavior: ScrollBehavior = 'smooth') {
  if (Math.abs(delta) < 1) return;
  if (container === window) {
    window.scrollBy({ top: delta, behavior });
    return;
  }
  const element = container as HTMLElement;
  element.scrollTo({ top: element.scrollTop + delta, behavior });
}

export function useTextareaFocus() {
  const [isInputFocused, setIsInputFocused] = useState(false);
  const textareaScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaViewportHandlerRef = useRef<(() => void) | null>(null);
  const textareaSelectionHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const updateFocused = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tag = target.tagName.toLowerCase();
      if (target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {
        setIsInputFocused(true);
      }
      if (target instanceof HTMLTextAreaElement) {
        setTextareaFocusState(true);
        const runScroll = () => scrollTextareaIntoView(target, 'smooth', 'focus');
        if (textareaScrollTimerRef.current) {
          clearTimeout(textareaScrollTimerRef.current);
        }
        if (textareaViewportHandlerRef.current && window.visualViewport) {
          window.visualViewport.removeEventListener('resize', textareaViewportHandlerRef.current);
          textareaViewportHandlerRef.current = null;
        }
        if (textareaSelectionHandlerRef.current) {
          document.removeEventListener('selectionchange', textareaSelectionHandlerRef.current);
          textareaSelectionHandlerRef.current = null;
        }
        const selectionHandler = () => {
          if (document.activeElement !== target) return;
          runScroll();
          if (textareaSelectionHandlerRef.current) {
            document.removeEventListener('selectionchange', textareaSelectionHandlerRef.current);
            textareaSelectionHandlerRef.current = null;
          }
        };
        textareaSelectionHandlerRef.current = selectionHandler;
        document.addEventListener('selectionchange', selectionHandler);
        setTimeout(() => {
          if (textareaSelectionHandlerRef.current) {
            document.removeEventListener('selectionchange', textareaSelectionHandlerRef.current);
            textareaSelectionHandlerRef.current = null;
          }
        }, 1200);
        if (window.visualViewport) {
          let ran = false;
          const handleResize = () => {
            ran = true;
            runScroll();
            if (textareaViewportHandlerRef.current) {
              window.visualViewport?.removeEventListener('resize', textareaViewportHandlerRef.current);
              textareaViewportHandlerRef.current = null;
            }
          };
          textareaViewportHandlerRef.current = handleResize;
          window.visualViewport.addEventListener('resize', handleResize);
          textareaScrollTimerRef.current = setTimeout(() => {
            if (!ran) runScroll();
            setTimeout(runScroll, 300);
            if (textareaViewportHandlerRef.current) {
              window.visualViewport?.removeEventListener('resize', textareaViewportHandlerRef.current);
              textareaViewportHandlerRef.current = null;
            }
          }, 600);
        } else {
          requestAnimationFrame(runScroll);
        }
      }
    };

    const clearFocused = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) {
        setIsInputFocused(false);
        setTextareaFocusState(false);
        if (textareaSelectionHandlerRef.current) {
          document.removeEventListener('selectionchange', textareaSelectionHandlerRef.current);
          textareaSelectionHandlerRef.current = null;
        }
        return;
      }
      const tag = active.tagName.toLowerCase();
      const stillFocused = active.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
      setIsInputFocused(stillFocused);
      setTextareaFocusState(active instanceof HTMLTextAreaElement);
    };

    document.addEventListener('focusin', updateFocused);
    document.addEventListener('focusout', clearFocused);
    return () => {
      document.removeEventListener('focusin', updateFocused);
      document.removeEventListener('focusout', clearFocused);
      if (textareaScrollTimerRef.current) {
        clearTimeout(textareaScrollTimerRef.current);
      }
      if (textareaViewportHandlerRef.current && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', textareaViewportHandlerRef.current);
        textareaViewportHandlerRef.current = null;
      }
      if (textareaSelectionHandlerRef.current) {
        document.removeEventListener('selectionchange', textareaSelectionHandlerRef.current);
        textareaSelectionHandlerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleAlignHeader = (event: Event) => {
      const detail = (event as CustomEvent<{ textarea?: HTMLTextAreaElement }>).detail;
      const textarea = detail?.textarea;
      if (!textarea) return;
      alignTextareaHeader(textarea);
    };
    document.addEventListener('textarea-align-header', handleAlignHeader as EventListener);
    return () => {
      document.removeEventListener('textarea-align-header', handleAlignHeader as EventListener);
    };
  }, []);

  return { isInputFocused };
}
