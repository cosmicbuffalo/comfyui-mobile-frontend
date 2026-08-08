# Spec: unified `mobile_file_state` + partial content hashing

Status: **implemented and under review.** Target branch: v3.1.x (unreleased,
so on-disk format and HTTP API may change freely — no back-compat obligations beyond a
one-time local migration for the user's own running instance).

## 1. Why

Three per-file "states" exist today, implemented three different ways:

| State | Identity | Persistence | Follows moves? | Survives name reuse? | Cross-device |
|-------|----------|-------------|----------------|----------------------|--------------|
| **Favorite** | content hash (full sha256) | `file_favorites.json` (server) | ✅ in-app + external | ✅ | ✅ |
| **Hidden** | path | `hidden_items.json` (server) | ✅ in-app only (`rename_path`) | ❌ | ✅ |
| **Reject** | path | client `localStorage` only | ❌ | ❌ | ❌ |

Favorites already do exactly what we want (identity follows the *bytes*). The goal is to
bring hidden and reject up to the same content-identity model, collapse the two nearly
identical Python modules into one, and make the hashing cheap enough for multi-GB videos.

## 2. Goals / non-goals

**Goals**
- One module, `mobile_file_state.py`, owning favorite + reject + hidden with identical
  storage, locking, move-rediscovery, and rename/remove hooks.
- Content identity for **files** across all three states: state follows the image no
  matter how it moves (in-app or external), and a *new* file that reuses an old
  name/location does **not** inherit the old state.
- **Cheap** hashing: read at most 2 MB per file regardless of size.
- Reject and hidden become server-synced, so all devices on one server agree.
- One-time, lossless migration of existing server-side favorites and hidden paths.
  Pre-existing local-only rejects are an explicitly accepted reset (§6.3).

**Non-goals**
- Real-time push. Sync is *on fetch* (a device sees another device's change on its next
  listing / hydration), not websocket-broadcast. (Noted as a possible follow-up.)
- Changing hidden's **folder** semantics (dir hide + descendant inheritance stay path-based).
- Deduplicating identical-content files into shared state on purpose (it's an accepted
  side effect, see §10).

## 3. Hashing strategy — `contentId`

Replace full-file sha256 with a **partial** digest:

```
contentId(file):
    size = os.stat(path).st_size
    if size <= 2 * CHUNK (CHUNK = 1 MiB):
        body = read entire file            # small files (most images) => full hash
    else:
        head = read first 1 MiB
        seek(size - 1 MiB); tail = read last 1 MiB
        body = head + tail
    digest = sha256( pack("<Q", size) + body ).hexdigest()
    return "p1:" + digest
```

- **Algorithm stays sha256** — we're only hashing ≤2 MB, so cost is trivial and we avoid
  introducing a new hash dependency. The `p1:` prefix tags "partial scheme v1" so:
  - legacy full-file digests (bare 64-char hex, no prefix) are distinguishable, and
  - a future scheme change (`p2:`, midpoint sample, etc.) is detectable without a data wipe.
- **Size is folded into the digest**, so two different files must share exact byte size
  *and* first 1 MiB *and* last 1 MiB to collide — negligible for generated media (see §10).
- Files ≤ 2 MiB are hashed in full, so the common small-image case is exact.

**Signature / fast path.** Each file entry stores `{ contentId, size, mtimeNs, path }`.
A candidate file is considered "the same" without re-hashing when `size` **and** `mtimeNs`
match the stored entry (current favorites behavior). Re-hash only when `mtimeNs` differs
(file may have changed) or when doing size-bucketed rediscovery of a moved file.

**Hashing stays off the hot path.** As favorites already do in `mark_favorites`, a listing
only hashes a candidate when its `size` matches the size of some tracked entry that wasn't
already path-matched. Files whose size collides with nothing tracked are never hashed.
This bounds listing-time hashing to "files that look like they might be a moved
favorite/reject/hidden item," and partial hashing makes even those cheap.

**One hashing path for all three states.** Every `set_state` call — favorite, reject, or
hidden — derives a file's identity through the *same* partial `contentId` function, so
marking any file is uniformly fast (≤2 MB read) regardless of which state and regardless of
file size. This is a deliberate change for two of the three:
- Favorite set goes from full-file sha256 → partial (faster on large files).
- Hidden set goes from an instant path append → a ≤2 MB hash+append (marginally slower than
  today, but now uniform with the others and, critically, hidden-of-a-file now *follows the
  bytes* instead of the path).
The uniformity is the point: no state is a special case, and no file size makes any single
"mark" operation slow.

## 4. Unified data model

Single cache file `file_state.json`:

```jsonc
{
  "version": 2,
  "updatedAt": 1720000000000,
  "states": {
    "output": {
      "favorite": [ <entry>, ... ],
      "reject":   [ <entry>, ... ],
      "hidden":   [ <entry>, ... ]
    },
    "input":  { "favorite": [...], "reject": [...], "hidden": [...] },
    "temp":   { ... }
  }
}
```

Entry shapes (unchanged from today's favorites entries, generalized to all states):

```jsonc
// file entry — content identity
{ "path": "sub/dir/img.png", "kind": "file", "contentId": "p1:ab…", "size": 1234, "mtimeNs": 169… }

// dir entry — path identity (folders can't be hashed)
{ "path": "sub/dir", "kind": "dir" }
```

Per-state semantics (the only differences between the three):

| State | dir entries? | inheritance | mutually exclusive with |
|-------|--------------|-------------|-------------------------|
| favorite | yes (favorite a folder; exact match, no inheritance) | no | reject |
| reject   | no (file-only) | no | favorite |
| hidden   | yes (hide a folder; **descendants inherit hidden**) | **yes** | — |

Everything else — content identity for files, move rediscovery, rename/remove hooks,
per-source buckets, locking, atomic write — is identical across the three, so it lives in
shared helpers parameterized by state name.

## 5. `mobile_file_state.py` API

State-parameterized versions of what favorites/hidden already expose:

```python
STATES = ("favorite", "reject", "hidden")

# Read — verified current paths for one (source, state). Prunes stale paths from the
# returned list but keeps them in the cache for later hash rediscovery (favorites behavior).
def get_paths(cache_path, source, state, base_dir) -> list[str]

# Read all three at once, for client hydration.
def get_all(cache_path, source, base_dir) -> {"favorite": [...], "reject": [...], "hidden": [...]}
# hidden also returns cached directory paths for the listing's inheritance walk. The route
# intersects this with get_paths verification; exact hidden files are content-verified there.
def get_hidden_paths(cache_path, source) -> set[str]   # fast, dirs only, no hashing

# Write one state for one path. Enforces mutual exclusivity server-side:
#   set favorite=True  -> also clears reject for that contentId
#   set reject=True    -> also clears favorite for that contentId
# Hashes the file at `path` (partial) to derive/att­ach contentId. Dir path + state in
# {favorite,hidden} -> dir entry; reject on a dir is rejected (no-op).
def set_state(cache_path, source, state, base_dir, path, value: bool) -> None

# Listing annotation. Mutates `files` in place, setting per-item flags and migrating moved
# entries' recorded paths (the generalized mark_favorites). Applies hidden inheritance.
#   file["favorite"], file["rejected"], file["hidden"], file["hiddenSelf"]
def annotate_listing(cache_path, source, base_dir, files, hidden_set) -> None

# Hooks fired by move / rename / delete handlers — apply to ALL states at once. Delete is
# two-phase so it removes only identities verified at the target before disk removal.
def rename_path(cache_path, source, old_path, new_path) -> None   # in-app move/rename
def plan_remove_path(cache_path, source, base_dir, path) -> dict
def remove_path(cache_path, source, path, removal_plan=None) -> None

# One-time migration (see §6).
def migrate_legacy(cache_path, *, favorites_path, hidden_path, hidden_legacy_paths) -> bool
```

Notes:
- `rename_path` is still needed even with content identity: it keeps the *recorded* `path`
  current on an in-app move so the fast path (size+mtime, no hashing) keeps hitting. Without
  it the file would fall through to size-bucketed re-hash on the next listing — correct but
  slower.
- Mutual exclusivity is enforced in one place (the module) instead of in the client, so it
  holds across devices.

## 6. Migration — guaranteed no favorite/hidden state loss

**Guarantee: no existing server-side favorite or hidden path is dropped by the switch to partial
hashing — including entries whose file is absent, moved, or on an unmounted drive at
migration time.** This is achieved with a *dual-key, lazy-upgrade* scheme: every legacy
entry keeps whatever identity it already had until it is safely upgraded to a `p1:`
`contentId`, and nothing is ever discarded for merely being un-hashable right now.

### Entry identity during transition

A file entry may carry, in addition to `path` / `size` / `mtimeNs`:
- `contentId` — the new `p1:` partial hash (authoritative once present), and/or
- `legacySha256` — the old full-file sha256 retained from a legacy favorite, kept as a
  *fallback* identity until upgraded.

Verification / rediscovery of a candidate file matches an entry if **any** hold:
1. `contentId` matches the candidate's partial hash (fast path), or
2. the entry still has `legacySha256` and the candidate's *full* sha256 matches it
   (fallback — bounded, see below), or
3. the entry has neither yet (path-only) and the candidate is at the entry's exact `path`.

Whenever a match is made via (2) or (3), the entry is **upgraded in place**: its `contentId`
is computed (partial) and stored, and `legacySha256` is dropped. So each legacy entry pays
the fallback cost **at most once**, the first time its file is seen, then rides the fast
path forever. The full-sha fallback only ever runs for size-bucket candidates that didn't
match by partial id *and* whose entry still has an un-upgraded `legacySha256` — a set that
only shrinks.

### One-time structural migration (startup, only if `file_state.json` absent)

1. **Favorites** (`file_favorites.json`): copy every entry into the unified schema.
   - `kind == "dir"` → dir entry, as-is.
   - `kind == "file"`, file present at recorded `path`: first prove it is the legacy
     identity using the stored size+mtime signature or the legacy full sha. Only then
     compute partial `contentId`, store it, and discard the old full sha. A replacement
     that reused the old name does not inherit the favorite.
   - `kind == "file"`, file **absent**: keep `path` + `size` + `mtimeNs` and **retain the
     old full sha as `legacySha256`**. Not hashed, not dropped — rediscoverable later via
     fallback (2), then upgraded.
2. **Hidden** (`hidden_items.json` + legacy paths): each path is stat'd.
   - dir → dir entry (descendant inheritance preserved exactly as today).
   - existing file → hashed to a `contentId` file entry (hiding now follows the bytes — a
     strict upgrade over today's path-only hidden).
   - **absent path** → `kind: "unknown"` path entry because the legacy format did not record
     whether it was a file or directory. When it returns it upgrades to either a hashed file
     or a directory entry with descendant inheritance.
3. **Reject**: **not migrated.** Reject exists today only in client `localStorage`, and
   per decision we accept losing those pre-existing client-side rejects in the switch. Reject
   simply starts empty server-side; no client replay, no `migratedRejectSources` flag. (The
   `localStorage` `rejected` field is dropped from the persisted partialize; any values there
   are just ignored.)

Because the eager pass uses *partial* hashing, migrating even hundreds of present favorites/
hidden files is a sub-second one-time startup cost. Legacy JSON files are left on disk (not
deleted), matching current `migrate_legacy_cache` behavior, so a rollback still has its data.

### Net effect per pre-existing state

| Pre-existing | After migration |
|--------------|-----------------|
| Favorite, original file present | identity verified, then re-hashed to `p1:` |
| Favorite, name reused by replacement | original retained via `legacySha256`; replacement is not favorited |
| Favorite, file absent/moved | retained via `legacySha256`; rediscovered by full-sha fallback on next sighting, then upgraded — **not lost** |
| Favorite on a folder | dir entry, unchanged |
| Hidden file (present) | upgraded to content identity (now follows moves) |
| Hidden path (absent) | `kind: unknown`; upgrades to hashed file or inheriting directory on next sighting |
| Hidden folder | dir entry + inheritance, unchanged |
| Reject (localStorage) | **not migrated — pre-existing client rejects are dropped** (accepted); reject starts empty server-side |

## 7. HTTP API changes

Consolidate the favorites/hidden endpoints into a state-generic pair, keep the listing as
the annotation channel:

- **Listing** (`GET /api/files`): each file item gains `rejected: bool` alongside the
  existing `favorite`, `hidden`, `hiddenSelf`. (favorite is exact, so no `favoriteSelf`.)
- **`GET /api/files/state?source=`** → `{ "favorite": [paths], "reject": [paths], "hidden": [paths] }`
  for client hydration (replaces `GET /api/files/favorites`).
- **`POST /api/files/state`** `{ source, path, state: "favorite"|"reject"|"hidden", value: bool }`
  → `{ ok: true }` (client updates optimistically + relies on next listing/hydration).
  Replaces `POST /api/files/favorites` and `POST /api/files/hidden`.

**Keep thin backward-compat shims** for the old three routes temporarily — `GET/POST
/api/files/favorites` and `POST /api/files/hidden` forward to the unified `set_state` /
`get_all` so a stale client or bookmarked call keeps working across the transition. These
shims are **temporary** and listed in §14 for removal. The move/rename/delete handlers call
the single `mobile_file_state.rename_path`; delete captures an identity-aware removal plan
before filesystem deletion and applies it afterward. This prevents deleting a replacement
at a reused name from erasing state belonging to an externally moved original.

## 8. Frontend changes

- `useOutputs`: `rejected` becomes server-backed exactly like `favorites` — hydrated from
  `GET /api/files/state`, mutated via `POST /api/files/state`. It stays a `string[]` of the
  client's path-based ids for *rendering membership* (the server owns content identity and
  returns verified paths); no change to how components read it.
- Drop `rejected` from the persisted `localStorage` partialize (server is now source of
  truth). No migration push — pre-existing client-side rejects are intentionally discarded
  (§6.3); `rejected` hydrates from the server going forward.
- `favoriteItem` / `toggleRejected` / `setItemHidden` all call the unified endpoint.
  Mutual-exclusivity clearing can be removed from the client (server enforces it) but the
  client should still optimistically reflect it to avoid a flash.
- `api/client/assets.ts`: replace `loadFileFavoritesFromServer` / `setFileFavorite` /
  `setFileHidden` with `loadFileState(source)` / `setFileState(source, path, state, value)`.
- Queue card, outputs panel, viewer: no change to how they *read* favorite/reject/hidden;
  only the underlying store hydration/mutation path changes.
- Mutations are serialized per `(source, path)` across all three states, so rapid actions
  reach the server in user order even if an earlier request is slower. Hydration/search
  waits for pending mutations for that source.
- Prompt-search results reconcile both positive and negative flags for every returned file:
  stale local favorite/reject membership is removed when the server returns the file
  unflagged, while state for files outside the result set is preserved.

## 9. Cross-device sync

Because all three states live in one server-side JSON, any device hitting the same ComfyUI
server converges on the next listing/hydration. A device that changes state does an
optimistic local update; other devices pick it up on their next `GET /api/files` or
`GET /api/files/state`. No live push in this scope (possible websocket follow-up: broadcast
a "file-state changed" event so open clients refetch immediately).

## 10. Edge cases & accepted tradeoffs

- **Identical-byte duplicates share state.** Two files with identical bytes have the same
  `contentId`, so favoriting/rejecting/hiding one applies to both. Rare for real outputs
  (counter + differing embedded metadata usually make "identical" outputs non-identical),
  and usually *desirable* ("it's the same image"). If it ever bites, a filename *tiebreaker*
  can be layered on later (soft discriminator only when one `contentId` maps to multiple
  entries — **not** a hard key, to preserve external-move robustness). Explicitly out of scope now.
- **Re-encode / metadata rewrite = state lost.** Rewriting a file's bytes changes its
  `contentId`, dropping its state. Outputs are write-once, so this is rare; it's the direct
  cost of content identity.
- **Partial-hash false identity.** Two *different* files sharing size + first 1 MiB + last
  1 MiB. Astronomically unlikely for generated media; worst case is one state bleeding to a
  lookalike (no corruption). §3's `p1:` prefix lets us strengthen the scheme later without a
  data wipe.
- **Missing-at-migration files are never dropped** (§6): favorites retain their legacy
  full-sha as a fallback identity; hidden paths keep an unknown-kind path entry. Both lazily
  upgrade on their next sighting. Reject has no legacy server state to migrate. The full-sha
  fallback runs at most once per legacy favorite.

## 11. Concurrency / performance

- Single module `RLock`; hashing is done **outside** the lock (as `mark_favorites` already
  does) and re-applied against a freshly reloaded cache, so a slow hash can't serialize
  other state writes. Re-application checks the exact observed path/kind/signature, so it
  cannot clobber a concurrent rename or refresh of the same identity.
- Atomic write via the shared `json_cache_io.atomic_write_json`.
- Listing-time hashing bounded to size-colliding candidates (§3), now ≤2 MB each.

## 12. Testing plan

- **pytest** (`python -m pytest tests/`, using an interpreter with ComfyUI's deps):
  - partial hash: small file (full-hashed) vs large file (head/tail); size folded in;
    changing a sampled head/tail byte changes `contentId`, while a middle-only change in a
    >2 MB file does not (the documented partial-hash tradeoff).
  - set/get/toggle per state; mutual exclusivity (favorite clears reject and vice versa).
  - move rediscovery: file moved externally is re-found by `contentId` on next listing.
  - name reuse: new file at an old favorited/rejected/hidden path is **not** flagged.
  - rename/remove hooks apply across all three states; hidden dir inheritance preserved.
  - migration from `file_favorites.json` + `hidden_items.json` (+ legacy) → `file_state.json`,
    including eager re-hash to `p1:` for present files.
  - **no-loss migration**: a legacy favorite whose file is *absent* keeps `legacySha256`,
    survives migration, and is rediscovered by full-sha fallback when the file reappears
    (moved to a new path), then is upgraded to `p1:` and `legacySha256` is dropped.
  - full-sha fallback runs **at most once** per legacy entry (assert it's not re-hashed on
    the next listing after upgrade).
  - hidden absent path → unknown-kind entry, later upgraded correctly as either file or dir.
  - migration name reuse, legacy favorite/reject exclusivity before hydration,
    identity-aware deletion, and concurrent annotation/rename guards.
- **vitest**: `useOutputs` reject/favorite hydration, optimistic mutual-exclusivity,
  per-file mutation ordering, prompt-search negative reconciliation, and assets client
  `setFileState`/`loadFileState`.

## 13. Resolved decisions

1. **Back-compat shims:** keep thin shims for the old three routes **temporarily** (§7); to
   be removed later (§14).
2. **Reject scope:** **file-only.** No folder rejects — a reject on a dir path is a no-op.
3. **Websocket "state changed" broadcast:** **deferred** to a later follow-up; sync stays
   on-fetch for now (§9).
4. **Cache file:** `file_state.json` under the existing mobile userdata dir — **confirmed.**
5. **Reject migration:** **none** — pre-existing client-side rejects are dropped (§6.3).
6. **`legacySha256` fallback:** **temporary.** Keep it in for now so no favorite is lost in
   the transition, but it is explicitly slated for removal (§14) — not retained indefinitely.

## 14. Temporary code to remove later

Track these so the transition scaffolding doesn't become permanent:

- **`legacySha256` fallback + upgrade path** (§6): once we're confident all real instances
  have re-listed their libraries (so legacy favorites have upgraded to `p1:`), delete the
  full-sha fallback branch and the `legacySha256` field. Any still-un-upgraded entry at that
  point degrades to path-only match, which is acceptable cleanup-time behavior.
- **Back-compat route shims** (§7): `GET/POST /api/files/favorites`, `POST /api/files/hidden`
  forwarding to the unified endpoints — remove once no shipped client calls them.
- **Legacy on-disk files**: `file_favorites.json` / `hidden_items.json` are left in place
  after migration for rollback safety; a later cleanup can delete them once `file_state.json`
  is established.
