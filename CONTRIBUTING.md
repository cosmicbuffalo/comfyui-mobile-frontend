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

## Supporting another pack's nodes

Several custom-node packs put their behaviour entirely in desktop-frontend
JavaScript. The only way a second frontend can support those nodes is to port
the logic — which means carrying a copy of someone else's moving target. When
they change it we diverge silently, and the symptom is a workflow that renders
or executes subtly wrong rather than an error anybody notices.

So every such port records what it assumes, in `scripts/node-parity/manifests.mjs`:

```bash
npm run parity                 # clone each pack at its latest, re-verify
npm run parity -- --local /path/to/custom_nodes   # check installed copies
npm run parity -- --json       # for a scheduled job
```

Exit status is 1 if an assumption no longer holds, and the failure names what we
assume, which file of ours depends on it, and what upstream now says.

Eight packs are covered: cg-use-everywhere, KJNodes, rgthree, VideoHelperSuite,
Autocomplete-Plus, Custom-Scripts, Impact Pack and Lora Manager.

Two rules when adding one:

- **Record only what our code actually depends on.** An assumption nobody relies
  on is noise that will eventually fail for a reason that does not matter, and
  teach everyone to ignore the check.
- **Give every assumption a `why` that names the failure.** "Upstream changed
  this string" is not actionable; "every wildcard dropdown stops being
  recognised, silently, and renders as a combo with one useless option" is.

The relationship differs by pack and the manifest should say so. For
cg-use-everywhere we reimplement an algorithm, so the assumptions are about
control flow. For Autocomplete-Plus and Custom-Scripts we consume HTTP routes
and parse their payloads, so the assumptions are about route names and column
order. For Impact Pack it is a single placeholder string that our entire
detection mechanism keys on.
