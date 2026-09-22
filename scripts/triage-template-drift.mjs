#!/usr/bin/env node
/**
 * Did ComfyUI just ship templates, or did something actually break?
 *
 * The template audit (`src/utils/__tests__/stockFrontendCompatibility.test.ts`)
 * answers two different questions in one run, and only one of them is a reason
 * to page anyone:
 *
 *   "would a workflow we edit still load in stock?"  — if this fails, we broke
 *      something, or stock changed under us. A person has to look.
 *   "is this the corpus we last audited?"            — if only this fails,
 *      upstream released templates. The audit cases above just re-ran against
 *      those very templates and passed, so the answer is a stale hash file.
 *
 * Left alone, the second question turns the weekly job red for a reason nobody
 * needs to act on, and a job that is usually red for no reason is a job whose
 * failures stop being read. This reads the run and says which of the two it
 * was, so the workflow can re-bless the manifest itself and stay green.
 *
 *   node scripts/triage-template-drift.mjs --results vitest.json --drift drift.json
 *
 * `--results` is vitest's `--reporter=json` output; `--drift` is the file named
 * by `TEMPLATE_DRIFT_REPORT`, which the manifest case writes its finding into
 * as data rather than prose. Both are produced by the same run.
 *
 * Verdict goes to stdout and to `$GITHUB_OUTPUT` as `verdict`; a markdown
 * report to `--report` (and `$GITHUB_STEP_SUMMARY`); a commit message for the
 * re-blessed manifest to `--commit-msg`. Composing those here rather than in
 * the workflow keeps the shell in the YAML down to plumbing. Exit status is 1
 * only for `broken` — the case that should stop the build.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * The manifest case, by name. Matched rather than counted: "one test failed"
 * is not the same claim as "the one test that fails on benign drift failed",
 * and only the second one licenses re-blessing anything.
 */
const MANIFEST_CASE = 'is the corpus this repo was last audited against';

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const resultsPath = value('--results');
const driftPath = value('--drift');
const reportPath = value('--report');
const commitMsgPath = value('--commit-msg');

const readJson = (path) => {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const results = readJson(resultsPath);
const drift = readJson(driftPath);

/** Every case that failed, flattened out of vitest's per-file grouping. */
function failedCases(run) {
  return (run.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).filter((test) => test.status === 'failed'),
  );
}

/**
 * A file that threw on import reports a failed suite with no failed cases in
 * it. That is emphatically not "nothing failed", and the shape is easy to miss
 * because the obvious check — are there failed assertions — says no.
 */
function suiteCrashed(run) {
  return (run.testResults ?? []).some(
    (file) =>
      file.status === 'failed' && !(file.assertionResults ?? []).some((t) => t.status === 'failed'),
  );
}

function verdictOf() {
  if (!results) return { verdict: 'broken', why: `No vitest results at ${resultsPath}.` };
  if (!results.numTotalTests) {
    return { verdict: 'broken', why: 'The audit reported no tests at all — it never ran.' };
  }
  if (suiteCrashed(results)) {
    return { verdict: 'broken', why: 'A test file failed outside any case (it threw on import).' };
  }

  const failed = failedCases(results);
  if (failed.length === 0) return { verdict: 'clean', why: 'Every audit case passed.' };

  const others = failed.filter((test) => test.title !== MANIFEST_CASE);
  if (others.length > 0) {
    return {
      verdict: 'broken',
      why: `${others.length} audit case(s) failed: ${others.map((t) => t.title).join('; ')}`,
    };
  }

  // Only the manifest case failed. It writes its finding out as data; if that
  // file is missing the run is not the one we think we are reading, and
  // re-blessing on a guess would launder a real regression into a commit.
  if (!drift) {
    return { verdict: 'broken', why: `The manifest case failed but wrote no drift report to ${driftPath}.` };
  }
  if (drift.newlyRejected?.length) {
    return {
      verdict: 'broken',
      why:
        `Stock's own loader would reject ${drift.newlyRejected.length} template(s) it did not before: `
        + `${drift.newlyRejected.join(', ')}. Either upstream shipped a broken workflow or the rules `
        + 'this suite reads out of stock have drifted.',
    };
  }
  return { verdict: 'drift', why: 'Upstream released templates; every audit case passed against them.' };
}

const { verdict, why } = verdictOf();

const counts = drift
  ? [
      ['added upstream', drift.added?.length ?? 0],
      ['removed upstream', drift.removed?.length ?? 0],
      ['rewritten upstream', drift.rewritten?.length ?? 0],
      ['newly rejected by stock', drift.newlyRejected?.length ?? 0],
      ['no longer rejected by stock', drift.noLongerRejected?.length ?? 0],
    ].filter(([, n]) => n > 0)
  : [];

const details = (label, files) =>
  files?.length
    ? [`<details><summary>${label} (${files.length})</summary>`, '', ...files.map((f) => `- \`${f}\``), '', '</details>', '']
    : [];

const heading = {
  clean: '✅ Templates unchanged, or changed and still audited green',
  drift: '📦 ComfyUI released templates — audit still green',
  broken: '❌ The template audit needs a person',
}[verdict];

const report = [
  `### ${heading}`,
  '',
  why,
  '',
  ...(counts.length
    ? [
        '| change | count |',
        '| --- | --- |',
        ...counts.map(([label, n]) => `| ${label} | ${n} |`),
        `| **templates audited** | **${drift.blessed} → ${drift.found}** |`,
        '',
      ]
    : []),
  ...(verdict === 'drift'
    ? [
        'Every case in `stockFrontendCompatibility.test.ts` re-ran against the new',
        'corpus and passed, so this is a stale hash file rather than a problem.',
        '',
      ]
    : []),
  ...details('Added upstream', drift?.added),
  ...details('Removed upstream', drift?.removed),
  ...details('Rewritten upstream', drift?.rewritten),
  ...details('No longer rejected by stock', drift?.noLongerRejected),
].join('\n');

/** One line, and it has to say what moved — this is what shows up in `git log`. */
const title = drift
  ? `Re-bless the stock template corpus (${drift.blessed} \u2192 ${drift.found} templates)`
  : 'Re-bless the stock template corpus';

const commitMessage = [
  title,
  '',
  "ComfyUI released workflow templates, so the manifest recording which corpus",
  'this repo was last audited against no longer matched the installed one. The',
  'weekly parity run re-ran every case in stockFrontendCompatibility.test.ts',
  'against the new set before writing this, and they all passed:',
  '',
  ...counts.map(([label, n]) => `  ${label}: ${n}`),
  '',
  'Nothing here changes behaviour. The manifest is provenance for the audit.',
].join('\n');

if (reportPath) writeFileSync(reportPath, `${report}\n`);
if (commitMsgPath) writeFileSync(commitMsgPath, `${commitMessage}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\ntitle=${title}\n`);
}

console.log(`verdict: ${verdict}`);
console.log(why);
if (verdict === 'broken') {
  console.log(`::error::Upstream parity: ${why}`);
  process.exit(1);
}
