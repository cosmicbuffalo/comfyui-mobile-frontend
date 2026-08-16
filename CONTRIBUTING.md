# Contributing

Thanks for improving ComfyUI Mobile Frontend. Keep a pull request focused,
include tests for behavior changes, and run the checks in the
[README](./README.md#testing) before submitting it.

## User-facing text and localization

English text is the source key for the translation layer. Any feature that adds
or changes text a user can see must update localization in the same pull
request.

- In React components, get `t` from `useI18n()` and render literal source keys
  such as `t('Generation queued')`.
- Outside React, import the non-reactive `t()` helper from `src/i18n`.
- Add every new key to all four dictionaries in `src/i18n/`: `zh-CN.ts`,
  `zh-TW.ts`, `ja.ts`, and `ko.ts`. Keep the dictionaries' key order aligned so
  reviews and merges stay manageable.
- Use one complete sentence with placeholders instead of concatenating
  translated fragments: `t('{count} generations queued', { count })`.
- Preserve every placeholder name exactly in every translation. Do not
  translate values such as filenames, workflow labels, server labels, or node
  titles supplied through placeholders.
- Prefer literal `t('…')` calls. The static test can find those automatically;
  if code must call `t(runtimeValue)`, explicitly ensure every possible value is
  present in all dictionaries.
- Do not use translated display text as a programmatic identifier or branch
  condition. Keep stable enum/sentinel values for logic and translate only at
  the display boundary.

Run the localization guard directly with:

```bash
npm test -- src/i18n/__tests__/i18n.test.ts
```

It rejects missing or duplicate keys, dictionary drift, and placeholder
mismatches. It cannot judge translation quality. The initial Chinese,
Japanese, and Korean dictionaries were machine-translated, so review by fluent
speakers is welcome—especially for destructive-action confirmations.

## Generated frontend assets

The custom node serves the committed `dist/` build. After changing frontend
source, run `npm run build` and include the resulting asset/manifest changes in
the pull request. CI verifies that the committed distribution matches source.
