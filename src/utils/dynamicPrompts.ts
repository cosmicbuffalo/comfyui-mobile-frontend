// Ported from the stock frontend's processDynamicPrompt
// (packages/shared-frontend-utils/src/formatUtil.ts). Stock runs it on every
// widget whose input declares `dynamicPrompts` (the Comfy.DynamicPrompts
// extension): C-style comments are stripped and each `{a|b|c}` is replaced by
// one randomly chosen option, recursively; `\{`, `\|` and `\}` stay literal.
export function processDynamicPrompt(input: string): string {
  function stripComments(str: string) {
    return str.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  }

  let i = 0;
  let result = '';
  input = stripComments(input);

  const handleEscape = () => {
    const nextChar = input[i++];
    return '\\' + nextChar;
  };

  function parseChoiceBlock() {
    const options: string[] = [];
    let choice = '';
    let depth = 0;

    while (i < input.length) {
      const char = input[i++];

      if (char === '\\') {
        choice += handleEscape();
        continue;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        if (!depth) break;
        depth--;
      } else if (char === '|') {
        if (!depth) {
          options.push(choice);
          choice = '';
          continue;
        }
      }
      choice += char;
    }

    options.push(choice);

    const chosenOption = options[Math.floor(Math.random() * options.length)];
    return processDynamicPrompt(chosenOption);
  }

  while (i < input.length) {
    const char = input[i++];
    if (char === '\\') {
      result += handleEscape();
    } else if (char === '{') {
      result += parseChoiceBlock();
    } else {
      result += char;
    }
  }

  return result.replace(/\\([{}|])/g, '$1');
}
