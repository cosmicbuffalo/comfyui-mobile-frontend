# Smoke test

`scripts/smoke-test.mjs` drives a real browser against a running ComfyUI. It
exists because the parts of this app most likely to break in a way unit tests
can't see are the parts that need a real server, a real GPU run, and a real
media pipeline: the app booting, a workflow running, a video decoding, state
round-tripping to disk.

Run it before tagging a release, and after any change to the queue panel, the
outputs panel, video playback, or file state.

## Running it

```bash
# once — Playwright is not a project dependency, so that CI (which never runs
# this) doesn't install a browser-automation library on every check
npm i -D playwright && npx playwright install chromium

# with ComfyUI running
npm run smoke
```

Options:

```bash
node scripts/smoke-test.mjs \
  --server http://127.0.0.1:8188 \
  --workflow "Basic SDXL" \    # any fast txt2img that needs no inputs
  --runs 4 \
  --keep-outputs               # skip the cleanup pass
```

It exits non-zero if any check fails **or** if the browser logged a single
console error, page exception, or failed request during the run. Aborted media
requests are ignored — the app cancels those on navigation by design.

## What it checks

| Check | Why it's here |
|---|---|
| App loads; workflow loads; N generations complete | The end-to-end path. Nothing else matters if this breaks. |
| Resolution badge reads `WxH` | The badge is computed from the file header server-side; a downscaled preview used to make it lie. |
| A queue card fits the viewport | The desktop one-page height cap. |
| **Zero DOM mutations over 4 idle seconds** | A re-render storm. The persisted per-card state maps are capped, and a cap that evicts a mounted card's key makes that card write it back — an unterminating cycle. This is the cheapest way to catch it. |
| Fold All folds everything and survives a reload | Automatic expansion paths have twice overridden an explicit fold. |
| Stack Outputs applies and persists | Desktop stacked layout. |
| Favorite round-trips to the server | File state is content-addressed server-side; a write that 409s must not silently no-op. |
| Download filename | The playback endpoint carries the name in a query param, so the browser once saved every video as `playable.mp4`. |
| "Use image" materializes an input | Exercises `link_or_copy` (reflink → hard link → copy) against the real filesystem. |
| Video: 3 range requests, then decode and play | Content-Type must stay **stable across range requests** — a file first served as `unprepared` and then replayed as `original` gets `video/mp4` stamped on a webm mid-stream, and playback dies. Also proves the file actually decodes. |

Video files are discovered from the outputs listing, so an install with no
videos skips those checks instead of failing on a path that doesn't exist there.

## What it does NOT cover

Be honest about these when deciding whether a release is ready:

- **The re-render loop at real scale.** It needs 500+ queue cards mounted, which
  needs 500+ history entries. The idle-churn check is a strong smell test, not
  proof. The mechanism itself is unit-tested in
  `src/hooks/__tests__/useQueueDisplaySlice.test.ts`.
- **Video inside a queue card.** The script runs an image workflow, so no video
  ever enters the queue. The stacked layout's aspect ratio for a video is
  covered only by
  `src/components/QueuePanel/__tests__/QueueCardResolutionBadge.test.tsx`.
- **The `unprepared` playback branch.** It only runs on a PyAV build with no
  H.264 encoder. Any install that can transcode never reaches it; see
  `tests/test_mobile_video_playback.py`.
- **Anything touch- or device-specific.** Headless Chromium on localhost cannot
  reproduce mobile Safari's media behaviour, gestures, or remote-network
  playback stalls.
- **The reflink path**, unless the ComfyUI volume is btrfs/XFS-with-reflink or
  bcachefs. On ext4 it falls through to a hard link, which is what the check
  actually observes.

## What it changes on your server

It generates real images, so it leaves `--runs` outputs and history entries
behind, like any other run. Everything else it touches — the favorite it sets,
the input file it materializes — is undone before it exits unless you pass
`--keep-outputs`.

Browser-side state is never a concern: Playwright launches a fresh profile each
time, so the fold state and layout preference it toggles live only in a
throwaway profile and never reach yours.

**If you interrupt the script mid-run**, its cleanup never executes. Check for
leftover queued generations and clear them:

```bash
curl -s "$SERVER/queue" | python3 -m json.tool | head
curl -X POST "$SERVER/queue" -H 'Content-Type: application/json' -d '{"clear": true}'
curl -X POST "$SERVER/interrupt"
```
