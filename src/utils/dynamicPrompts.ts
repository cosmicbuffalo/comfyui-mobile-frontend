// The dynamic prompt syntax stock's Comfy.DynamicPrompts extension applies to
// widgets whose input declares `dynamicPrompts`: `//` and `/* */` comments are
// removed, each `{a|b|c}` becomes one of its options picked at random (options
// may hold further choices), and `\{`, `\|`, `\}` stand for the characters
// themselves. Written from that behaviour; stock's frontend is GPL-3 and this
// project is MIT, so none of its code is copied here.
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*/g;

export function processDynamicPrompt(text: string): string {
  return expandChoices(text.replace(COMMENTS, '')).replace(/\\([{}|])/g, '$1');
}

/**
 * Resolve every choice in `text`, leaving its own escapes for the caller. A
 * picked option goes through the whole process, as in stock, so escapes inside
 * it are unescaped there and again with the text around it.
 */
function expandChoices(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      out += text.slice(i, i + 2);
      i += 2;
    } else if (text[i] === '{') {
      const { options, end } = readChoice(text, i + 1);
      out += processDynamicPrompt(options[Math.floor(Math.random() * options.length)]);
      i = end + 1;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * The options of the choice whose body starts at `start`, split on the `|`s
 * outside any nested choice, and the index of its closing `}` (the end of the
 * text when it never closes).
 */
function readChoice(text: string, start: number): { options: string[]; end: number } {
  const options: string[] = [];
  let depth = 0;
  let from = start;
  let i = start;
  for (; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i += 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === '|' && depth === 0) {
      options.push(text.slice(from, i));
      from = i + 1;
    }
  }
  options.push(text.slice(from, i));
  return { options, end: i };
}
