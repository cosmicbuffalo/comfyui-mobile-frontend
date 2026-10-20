import { Children, cloneElement, isValidElement, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { components, type MenuListProps, type OptionProps } from 'react-select';
import type { ComboSelectOption } from './ModelComboOption';

const WINDOW_THRESHOLD = 100;
const OVERSCAN = 5;

/** Variable-height rows; the fullscreen modal keeps ownership of touch scrolling. */
export function WindowedComboMenuList(props: MenuListProps<ComboSelectOption, boolean>) {
  const children = Children.toArray(props.children);
  const options = children.filter((child) => isValidElement<OptionProps<ComboSelectOption, boolean>>(child) && child.props.data);
  if (options.length <= WINDOW_THRESHOLD || options.length !== children.length) {
    return <components.MenuList {...props} />;
  }
  return <WindowedRows {...props} rows={options as React.ReactElement<OptionProps<ComboSelectOption, boolean>>[]} />;
}

function WindowedRows({ rows, ...props }: MenuListProps<ComboSelectOption, boolean> & {
  rows: React.ReactElement<OptionProps<ComboSelectOption, boolean>>[];
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const heights = useRef(new Map<string, number>());
  const lastFocus = useRef<{ value: string | undefined; input: string; options: unknown; height: number; revision: number; top: number } | null>(null);
  const keepFocusVisible = useRef(true);
  const initialSelection = useRef<string | undefined>(props.getValue()[0]?.value);
  const [revision, setRevision] = useState(0);
  const [initialTop] = useState(() => {
    const value = props.getValue()[0]?.value ?? props.focusedOption?.value;
    const index = rows.findIndex((row) => row.props.data.value === value);
    if (index < 1) return 0;
    return Math.max(0, rows.slice(0, index).reduce((sum, row) => sum + (row.props.data.model ? 92 : 40), 0));
  });
  const [viewport, setViewport] = useState({ top: initialTop, height: props.maxHeight });
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) {
      const estimate = row.props.data.model ? 92 : 40;
      result.push(result.at(-1)! + (heights.current.get(row.props.data.value) ?? estimate));
    }
    return result;
    // Measured heights are kept outside render state; revision invalidates offsets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, revision]);
  const total = offsets.at(-1)!;
  const lowerBound = (offset: number) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1] < offset) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const start = Math.max(0, lowerBound(viewport.top) - OVERSCAN);
  const end = Math.min(rows.length, lowerBound(viewport.top + viewport.height) + OVERSCAN + 1);

  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    // Modal lists intentionally have overflow:visible. Inline/desktop lists
    // keep react-select's own scroller and portal placement.
    const external = getComputedStyle(list).overflowY === 'visible';
    const scroll = external ? list.closest<HTMLElement>('.scroll-container') : list;
    if (!scroll) return;
    scroller.current = scroll;
    let frame = 0;
    const measure = () => {
      const top = scroll === list ? scroll.scrollTop : Math.max(0, scroll.getBoundingClientRect().top - list.getBoundingClientRect().top);
      const height = scroll.clientHeight || props.maxHeight;
      setViewport((previous) => previous.top === top && previous.height === height ? previous : { top, height });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const releaseFocus = () => {
      keepFocusVisible.current = false;
      initialSelection.current = undefined;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.movementX || event.movementY) releaseFocus();
    };
    const onKeyDown = () => {
      // Only user input releases the opening selection. Layout can synthesize
      // hover/focus changes while measured rows grow underneath the pointer.
      initialSelection.current = undefined;
      keepFocusVisible.current = true;
      // End/Home can keep the same focused option after a manual scroll.
      // Re-evaluate its position even when react-select reuses that option.
      lastFocus.current = null;
    };
    // Let react-select focus its search input before positioning the selected
    // row. Native focus scrolling would otherwise undo our initial position.
    const initialFrame = requestAnimationFrame(() => {
      if (initialTop > 0) {
        const top = scroll === list ? scroll.scrollTop : Math.max(0, scroll.getBoundingClientRect().top - list.getBoundingClientRect().top);
        scroll.scrollTop += initialTop - top;
      }
      measure();
    });
    scroll.addEventListener('scroll', schedule, { passive: true });
    scroll.addEventListener('wheel', releaseFocus, { passive: true });
    scroll.addEventListener('touchmove', releaseFocus, { passive: true });
    scroll.addEventListener('pointerdown', releaseFocus, { passive: true });
    scroll.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('keydown', onKeyDown, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scroll);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(initialFrame);
      observer?.disconnect();
      scroll.removeEventListener('scroll', schedule);
      scroll.removeEventListener('wheel', releaseFocus);
      scroll.removeEventListener('touchmove', releaseFocus);
      scroll.removeEventListener('pointerdown', releaseFocus);
      scroll.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('keydown', onKeyDown, true);
      scroller.current = null;
    };
  }, [props.maxHeight, initialTop]);

  useLayoutEffect(() => {
    const list = root.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.optionValue!;
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setRevision((value) => value + 1);
    });
    for (const row of list.querySelectorAll('[data-option-value]')) observer.observe(row);
    return () => observer.disconnect();
  }, [start, end, rows]);

  useLayoutEffect(() => {
    const list = root.current;
    const scroll = scroller.current;
    if (!list || !scroll) return;
    const openingSelection = rows.findIndex((row) => row.props.data.value === initialSelection.current);
    const focused = openingSelection >= 0 ? openingSelection : rows.findIndex((row) => row.props.data === props.focusedOption);
    const top = scroll === list ? scroll.scrollTop : Math.max(0, scroll.getBoundingClientRect().top - list.getBoundingClientRect().top);
    const height = scroll.clientHeight || props.maxHeight;
    const value = rows[focused]?.props.data.value;
    const input = props.selectProps.inputValue;
    const previous = lastFocus.current;
    const focusChanged = !previous || previous.value !== value || previous.input !== input || previous.options !== props.options;
    if (!focusChanged && previous.height === height && previous.revision === revision && previous.top === top) return;
    lastFocus.current = { value, input, options: props.options, height, revision, top };
    if (!keepFocusVisible.current) return;
    let target = top;
    if (focused >= 0) {
      if (offsets[focused] < top) target = offsets[focused];
      else if (offsets[focused + 1] > top + height) target = offsets[focused + 1] - height;
    } else if (top > total) target = 0;
    if (target !== top) {
      scroll.scrollTop += target - top;
      setViewport({ top: target, height });
      lastFocus.current.top = target;
    }
  }, [props.focusedOption, props.selectProps.inputValue, props.options, rows, offsets, total, props.maxHeight, revision, viewport.top, viewport.height]);

  return (
    <components.MenuList {...props} innerProps={{
      ...props.innerProps,
      style: { ...props.innerProps?.style, overflowAnchor: 'none', padding: 0 },
      // Opening/positioning a list under a stationary pointer must not move
      // react-select's focus away from its selected value. Real pointer motion
      // releases the initial anchor before the mouse event arrives.
      onMouseOverCapture: (event) => { if (initialSelection.current != null) event.stopPropagation(); },
      onMouseMoveCapture: (event) => { if (initialSelection.current != null) event.stopPropagation(); },
    }} innerRef={(element) => {
      root.current = element;
      if (typeof props.innerRef === 'function') props.innerRef(element);
      else if (props.innerRef) props.innerRef.current = element;
    }}>
      <div aria-hidden="true" style={{ height: offsets[start] }} />
      {rows.slice(start, end).map((row, index) => (
        <div key={row.props.data.value} data-option-value={row.props.data.value}>
          {cloneElement(row, { innerProps: { ...row.props.innerProps, 'aria-setsize': rows.length, 'aria-posinset': start + index + 1 } })}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: Math.max(0, total - offsets[end]) }} />
    </components.MenuList>
  );
}
