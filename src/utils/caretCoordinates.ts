// Measure the pixel position of the caret inside a <textarea>. Textareas don't
// expose this natively, so we render a hidden "mirror" div that copies the
// textarea's text-layout styles, put the text up to the caret in it, and read
// the offset of a marker span. Adapted from the well-known textarea-caret-position
// technique (component/textarea-caret-position).

export interface CaretCoordinates {
  /** Caret top, relative to the textarea's top padding edge (excludes scroll). */
  top: number;
  /** Caret left, relative to the textarea's left padding edge. */
  left: number;
  /** Line height at the caret — i.e. the height of the current line. */
  height: number;
}

// Style properties that affect text wrapping/layout and must be mirrored.
const MIRRORED_PROPS = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordWrap',
  'wordBreak',
] as const;

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoordinates {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const style = mirror.style;

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflow = 'hidden';
  for (const prop of MIRRORED_PROPS) {
    style[prop] = computed[prop];
  }
  // A textarea always wraps (no horizontal scroll), so pin the width even if the
  // box-sizing maths would otherwise let the mirror grow.
  style.width = computed.width;

  mirror.textContent = textarea.value.slice(0, position);
  // A marker whose offset is the caret position. Non-empty so it has a box even
  // at end-of-text / after a trailing newline.
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(position) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const lineHeight =
    parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 16;
  const coords: CaretCoordinates = {
    top: marker.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: marker.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    height: lineHeight,
  };
  document.body.removeChild(mirror);
  return coords;
}
