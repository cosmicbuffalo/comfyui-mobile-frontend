// Shared CSV line parser for the two autocomplete-data clients. Both
// Custom-Scripts and Autocomplete-Plus expose alias columns as quoted,
// comma-separated lists, so both had carried an identical copy of this.
//
// Quoted fields may contain commas (the alias column is a quoted
// comma-separated list); a doubled quote is an escaped literal quote.
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
