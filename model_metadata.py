"""Standalone model-metadata provider for the mobile frontend.

This gives the mobile frontend the same rich model-picker data (preview image,
display name + version, base-model badge) that ComfyUI Lora Manager provides —
but without depending on Lora Manager being installed.

Interoperability is by design: we read and write the *same*
``<model>.metadata.json`` sidecar files (and sibling preview files) that Lora
Manager uses. So the two coexist:

  * LM installed  -> the frontend prefers LM's own API (this module is dormant).
  * LM absent     -> we read any sidecars LM previously wrote, and for models
                     with no sidecar we hash the file, query Civitai by hash,
                     download a preview, and write a sidecar in LM's format.
  * Either way    -> the on-disk sidecars are shared, so installing/uninstalling
                     LM later loses nothing.

Only the on-disk conventions are shared with Lora Manager; there is no code
dependency on it.

Design notes / safety:
  * The ``list`` path only reads sidecars + stats files — it never hashes, so it
    is fast and cannot stall or empty its result mid-run.
  * Hashing runs in a thread executor (off the event loop) and Civitai requests
    are concurrency-limited, so a populate pass won't peg the server.
  * Population is idempotent: a model that isn't on Civitai is recorded as
    checked (``from_civitai: false``) so we don't re-hash it on every pass.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import threading
import time
import urllib.parse

import folder_paths

logger = logging.getLogger("mobile_frontend.model_metadata")

CIVITAI_BY_HASH = "https://civitai.com/api/v1/model-versions/by-hash/{}"
PREVIEW_ROUTE = "/mobile/api/models/previews"

# Model file extensions we treat as selectable models.
MODEL_EXTENSIONS = {
    ".safetensors", ".ckpt", ".pt", ".pt2", ".pth",
    ".bin", ".sft", ".gguf", ".pkl",
}

# Sibling preview file extensions, in priority order (mirrors Lora Manager).
PREVIEW_EXTENSIONS = [
    ".webp", ".preview.webp", ".preview.png", ".preview.jpeg", ".preview.jpg",
    ".preview.mp4", ".png", ".jpeg", ".jpg", ".mp4", ".gif", ".webm",
]

# prefix -> list of (folder_paths key, default sub_type)
PREFIX_FOLDER_KEYS = {
    "loras": [("loras", "lora")],
    "checkpoints": [
        ("checkpoints", "checkpoint"),
        ("diffusion_models", "diffusion_model"),
        ("unet", "diffusion_model"),
    ],
    "embeddings": [("embeddings", "embedding")],
}

# Ported from Lora Manager's model_utils.BASE_MODEL_MAPPING so our badges match.
BASE_MODEL_MAPPING = {
    "sd_1.5": "SD 1.5",
    "sd-v1-5": "SD 1.5",
    "sd-v2-1": "SD 2.1",
    "sdxl": "SDXL 1.0",
    "sd-v2": "SD 2.0",
    "flux1": "Flux.1 D",
    "flux.1 d": "Flux.1 D",
    "illustrious": "Illustrious",
    "il": "Illustrious",
    "pony": "Pony",
    "hunyuan video": "Hunyuan Video",
}

# Civitai baseModel values that are really diffusion models (unet), not
# checkpoints — ported from Lora Manager's constants.DIFFUSION_MODEL_BASE_MODELS.
DIFFUSION_MODEL_BASE_MODELS = frozenset([
    "ZImageTurbo",
    "Wan Video 1.3B t2v",
    "Wan Video 14B t2v",
    "Wan Video 14B i2v 480p",
    "Wan Video 14B i2v 720p",
    "Wan Video 2.2 TI2V-5B",
    "Wan Video 2.2 I2V-A14B",
    "Wan Video 2.2 T2V-A14B",
    "Wan Video 2.5 T2V",
    "Wan Video 2.5 I2V",
    "Qwen",
])

HASH_CHUNK_BYTES = 4 * 1024 * 1024
PREVIEW_WIDTH = 480
PREVIEW_QUALITY = 85
CIVITAI_CONCURRENCY = 4

# Per-prefix populate progress, surfaced via the fetch-status endpoint.
_fetch_state = {}


def determine_base_model(version_string):
    """Map a Civitai baseModel string to a normalized label (LM-compatible)."""
    if not version_string:
        return "Unknown"
    low = version_string.lower()
    for key, value in BASE_MODEL_MAPPING.items():
        if key in low:
            return value
    return version_string


# --------------------------------------------------------------------------- #
# Filesystem enumeration
# --------------------------------------------------------------------------- #

def _folder_roots(prefix):
    """Yield (root_dir, default_sub_type) for a prefix, de-duplicated."""
    seen = set()
    for key, sub_type in PREFIX_FOLDER_KEYS.get(prefix, []):
        try:
            roots = folder_paths.get_folder_paths(key)
        except Exception:
            roots = []
        for root in roots or []:
            real = os.path.realpath(root)
            if real in seen or not os.path.isdir(real):
                continue
            seen.add(real)
            yield root, sub_type


def _iter_model_files(prefix):
    """Yield (model_path, root_dir, default_sub_type) for every model file."""
    seen = set()
    seen_dirs = set()
    for root, sub_type in _folder_roots(prefix):
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            # followlinks=True can loop forever on a symlink cycle; track real
            # dir paths and prune ones we've already descended into.
            real_dir = os.path.realpath(dirpath)
            if real_dir in seen_dirs:
                dirnames[:] = []
                continue
            seen_dirs.add(real_dir)
            dirnames[:] = [
                d for d in dirnames
                if os.path.realpath(os.path.join(dirpath, d)) not in seen_dirs
            ]
            for name in filenames:
                ext = os.path.splitext(name)[1].lower()
                if ext not in MODEL_EXTENSIONS:
                    continue
                abs_path = os.path.join(dirpath, name)
                real = os.path.realpath(abs_path)
                if real in seen:
                    continue
                seen.add(real)
                yield abs_path, root, sub_type


def _all_model_roots():
    roots = []
    for prefix in PREFIX_FOLDER_KEYS:
        for root, _sub_type in _folder_roots(prefix):
            roots.append(os.path.realpath(root))
    return roots


def is_within_model_roots(abs_path):
    real = os.path.realpath(abs_path)
    for root in _all_model_roots():
        if real == root or real.startswith(root + os.sep):
            return True
    return False


# --------------------------------------------------------------------------- #
# Sidecar + preview helpers
# --------------------------------------------------------------------------- #

def _sidecar_path(model_path):
    return os.path.splitext(model_path)[0] + ".metadata.json"


def _load_sidecar(model_path):
    path = _sidecar_path(model_path)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _save_sidecar(model_path, sidecar):
    path = _sidecar_path(model_path)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(sidecar, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        # The scanned-list cache now has stale metadata for this model — drop
        # only its prefix's entries (other model types stay cached).
        invalidate_list_cache(_prefix_for_model_path(model_path))
    except OSError as exc:
        logger.warning("Failed to write sidecar %s: %s", path, exc)
        try:
            os.remove(tmp)
        except OSError:
            pass


def _find_preview(model_path):
    stem = os.path.splitext(model_path)[0]
    for ext in PREVIEW_EXTENSIONS:
        candidate = stem + ext
        if os.path.isfile(candidate):
            return candidate
    return None


def _preview_url(preview_path):
    if not preview_path:
        return ""
    return PREVIEW_ROUTE + "?path=" + urllib.parse.quote(preview_path, safe="")


def _build_item(model_path, root, default_sub_type, sidecar):
    """Build one LM-compatible list item from a model file (+ optional sidecar)."""
    abs_path = os.path.abspath(model_path).replace("\\", "/")
    stem = os.path.splitext(os.path.basename(model_path))[0]
    # Resolve both sides to realpaths so a symlinked root doesn't yield a
    # relpath full of ``..`` segments.
    rel_dir = os.path.relpath(
        os.path.realpath(os.path.dirname(model_path)), os.path.realpath(root)
    )
    rel_dir = rel_dir.replace("\\", "/")
    folder = "" if rel_dir in (".", "") or rel_dir.startswith("..") else rel_dir
    try:
        file_size = os.path.getsize(model_path)
    except OSError:
        file_size = 0

    preview_path = _find_preview(model_path)

    item = {
        "model_name": stem,
        "file_name": stem,
        "preview_url": _preview_url(preview_path),
        "preview_nsfw_level": 0,
        "base_model": "Unknown",
        "folder": folder,
        "sha256": "",
        "file_path": abs_path,
        "file_size": file_size,
        "sub_type": default_sub_type,
        "favorite": False,
        "civitai": None,
    }

    if sidecar:
        item["model_name"] = sidecar.get("model_name") or stem
        item["base_model"] = sidecar.get("base_model") or "Unknown"
        item["preview_nsfw_level"] = sidecar.get("preview_nsfw_level") or 0
        item["sha256"] = sidecar.get("sha256") or ""
        item["sub_type"] = sidecar.get("sub_type") or default_sub_type
        item["favorite"] = bool(sidecar.get("favorite"))
        civ = sidecar.get("civitai")
        item["civitai"] = civ if (isinstance(civ, dict) and civ) else None
        # Prefer a sibling preview we can serve; otherwise fall back to a sidecar
        # preview_url that points at an on-disk file (LM stores an absolute path).
        if not preview_path:
            stored = (sidecar.get("preview_url") or "").strip()
            if (
                stored
                and not stored.startswith("/api/")
                and not stored.startswith("/mobile/")
                and os.path.isfile(stored)
            ):
                item["preview_url"] = _preview_url(stored)

    return item


# --------------------------------------------------------------------------- #
# Listing
# --------------------------------------------------------------------------- #

# Cache of fully-scanned (walk + sidecar read + sort) item lists per prefix. The
# scan recursively walks every model root and opens a JSON sidecar per file, so
# without this every paginated `list` request (and every populate-progress
# reload) re-did the whole thing on the event loop. Invalidated on a short TTL
# (catches manually-added model files) and explicitly when a sidecar is written
# (so the populate live-fill reflects new metadata immediately).
# Keyed by (prefix, resolved-root-paths) so a folder_paths config change (or a
# test pointing the same prefix at a fresh dir) misses instead of serving stale.
_LIST_CACHE: dict[tuple, tuple[float, list]] = {}
_LIST_CACHE_TTL = 60.0
_LIST_CACHE_LOCK = threading.Lock()


def _scan_model_items(prefix):
    items = []
    for model_path, root, sub_type in _iter_model_files(prefix):
        sidecar = _load_sidecar(model_path)
        items.append(_build_item(model_path, root, sub_type, sidecar))
    items.sort(key=lambda entry: entry["file_name"].lower())
    return items


def _get_model_items(prefix):
    # Cheap (no walk): just resolves the configured root dirs for the key.
    roots_key = tuple(sorted(os.path.realpath(r) for r, _ in _folder_roots(prefix)))
    key = (prefix, roots_key)
    now = time.monotonic()
    with _LIST_CACHE_LOCK:
        cached = _LIST_CACHE.get(key)
        if cached is not None and now - cached[0] < _LIST_CACHE_TTL:
            return cached[1]
    # Scan outside the lock so concurrent prefixes don't serialize; a rare
    # double-scan is harmless (last writer wins, same data).
    items = _scan_model_items(prefix)
    with _LIST_CACHE_LOCK:
        _LIST_CACHE[key] = (time.monotonic(), items)
    return items


def _prefix_for_model_path(model_path):
    """Which model prefix (loras/checkpoints/embeddings) a file lives under, or
    None if it's not under any configured root."""
    real = os.path.realpath(model_path)
    for prefix in PREFIX_FOLDER_KEYS:
        for root, _sub_type in _folder_roots(prefix):
            root_real = os.path.realpath(root)
            if real == root_real or real.startswith(root_real + os.sep):
                return prefix
    return None


def invalidate_list_cache(prefix=None):
    """Drop the scanned-list cache (e.g. after writing a sidecar) so the next
    `list` request reflects the change. When a prefix is given, only that
    prefix's entries are dropped — so populating one model type doesn't force a
    full re-walk of the others on their next list request."""
    with _LIST_CACHE_LOCK:
        if prefix is None:
            _LIST_CACHE.clear()
        else:
            for key in [k for k in _LIST_CACHE if k[0] == prefix]:
                del _LIST_CACHE[key]


def list_models(prefix, page=1, page_size=500):
    if prefix not in PREFIX_FOLDER_KEYS:
        return {"items": [], "total": 0, "page": page,
                "page_size": page_size, "total_pages": 0}

    items = _get_model_items(prefix)

    total = len(items)
    page = max(1, int(page or 1))
    page_size = max(1, int(page_size or 500))
    start = (page - 1) * page_size
    # Shallow-copy each item so a caller reassigning a top-level key can't corrupt
    # the cached `items` list. (Cheap — a deepcopy here would traverse the whole
    # nested `civitai` payload per item on every paginated request; nested values
    # are treated as read-only.)
    page_items = [dict(item) for item in items[start:start + page_size]]
    total_pages = (total + page_size - 1) // page_size if page_size else 0
    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


# --------------------------------------------------------------------------- #
# Population (hash -> Civitai -> sidecar + preview)
# --------------------------------------------------------------------------- #

def _sha256_sync(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _compute_sha256(path):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sha256_sync, path)


def _has_usable_preview(model_path, sidecar):
    """Whether the model already has a preview we can display — a sibling preview
    file, or a sidecar preview_url that points at an on-disk file (LM stores an
    absolute path). Mirrors the preview resolution in _build_item."""
    if _find_preview(model_path):
        return True
    stored = (sidecar.get("preview_url") or "").strip()
    return bool(
        stored
        and not stored.startswith("/api/")
        and not stored.startswith("/mobile/")
        and os.path.isfile(stored)
    )


def _needs_fetch(model_path):
    sidecar = _load_sidecar(model_path)
    if not sidecar:
        return True
    civ = sidecar.get("civitai")
    if isinstance(civ, dict) and civ.get("id"):
        return False
    # Already hashed and confirmed absent from Civitai — don't keep re-hashing.
    if sidecar.get("from_civitai") is False and sidecar.get("sha256"):
        return False
    # Already enriched from another source (e.g. a Lora Manager sidecar): a known
    # base model plus a resolvable preview. Re-hashing (full SHA-256) and
    # re-querying Civitai for these is what makes the force=False refresh slow on
    # libraries that already have metadata — and re-downloading the preview can
    # clobber a good one on a transient/failed lookup. Treat them as done.
    base_model = (sidecar.get("base_model") or "").strip()
    if base_model and base_model != "Unknown" and _has_usable_preview(model_path, sidecar):
        return False
    return True


async def _civitai_by_hash(session, sha256):
    import aiohttp
    url = CIVITAI_BY_HASH.format(sha256)
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception as exc:
        logger.warning("Civitai lookup failed for %s: %s", sha256, exc)
        return None


def _select_preview(images):
    """Pick the showcase image (Civitai's first). Returns (url, type, nsfw)."""
    if not images:
        return None
    chosen = images[0]
    return (
        chosen.get("url"),
        chosen.get("type") or "image",
        int(chosen.get("nsfwLevel") or 0),
    )


def _optimize_image_to_webp(raw, out_path):
    from PIL import Image, ImageOps
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    if image.width > PREVIEW_WIDTH:
        height = int(image.height * PREVIEW_WIDTH / image.width)
        image = image.resize((PREVIEW_WIDTH, height), Image.LANCZOS)
    image.save(out_path, format="WEBP", quality=PREVIEW_QUALITY)


async def _download_preview(session, url, media_type, model_path, sidecar):
    import aiohttp
    stem = os.path.splitext(model_path)[0]
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status != 200:
                return
            raw = await resp.read()
    except Exception as exc:
        logger.warning("Preview download failed (%s): %s", url, exc)
        return

    bare = url.lower().split("?", 1)[0]
    is_video = media_type == "video" or bare.endswith((".mp4", ".webm"))

    if is_video:
        ext = ".webm" if bare.endswith(".webm") else ".mp4"
        out = stem + ext
        try:
            with open(out, "wb") as handle:
                handle.write(raw)
            sidecar["preview_url"] = out.replace("\\", "/")
        except OSError as exc:
            logger.warning("Failed to save video preview %s: %s", out, exc)
        return

    out = stem + ".webp"
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _optimize_image_to_webp, raw, out)
        sidecar["preview_url"] = out.replace("\\", "/")
    except Exception as exc:
        logger.warning("WebP transcode failed (%s); saving original", exc)
        ext = os.path.splitext(bare)[1] or ".jpeg"
        out = stem + ext
        try:
            with open(out, "wb") as handle:
                handle.write(raw)
            sidecar["preview_url"] = out.replace("\\", "/")
        except OSError as oserr:
            logger.warning("Failed to save preview %s: %s", out, oserr)


async def _populate_model(session, model_path, default_sub_type, sem):
    async with sem:
        try:
            sha256 = await _compute_sha256(model_path)
        except OSError as exc:
            logger.warning("Hash failed for %s: %s", model_path, exc)
            return False

        data = await _civitai_by_hash(session, sha256)

        stem = os.path.splitext(os.path.basename(model_path))[0]
        sidecar = _load_sidecar(model_path) or {}
        sidecar.setdefault("file_name", stem)
        sidecar["file_path"] = os.path.abspath(model_path).replace("\\", "/")
        try:
            sidecar["size"] = os.path.getsize(model_path)
            sidecar["modified"] = os.path.getmtime(model_path)
        except OSError:
            pass
        sidecar["sha256"] = sha256
        sidecar["sub_type"] = sidecar.get("sub_type") or default_sub_type
        sidecar["last_checked_at"] = time.time()

        if not data:
            # Not on Civitai — record the attempt so future passes skip it.
            sidecar.setdefault("model_name", stem)
            sidecar.setdefault("base_model", "Unknown")
            sidecar.setdefault("preview_url", "")
            sidecar.setdefault("preview_nsfw_level", 0)
            sidecar["from_civitai"] = False
            sidecar.setdefault("civitai", None)
            _save_sidecar(model_path, sidecar)
            return False

        model = data.get("model") or {}
        base_raw = data.get("baseModel")
        sidecar["model_name"] = model.get("name") or stem
        sidecar["base_model"] = determine_base_model(base_raw)
        if (
            default_sub_type in ("checkpoint", "diffusion_model")
            and base_raw in DIFFUSION_MODEL_BASE_MODELS
        ):
            sidecar["sub_type"] = "diffusion_model"
        sidecar["from_civitai"] = True
        sidecar["civitai"] = data

        preview = _select_preview(data.get("images") or [])
        if preview and preview[0]:
            url, media_type, nsfw_level = preview
            await _download_preview(session, url, media_type, model_path, sidecar)
            sidecar["preview_nsfw_level"] = nsfw_level

        _save_sidecar(model_path, sidecar)
        return True


def _public_state(state):
    return {
        "running": bool(state.get("running")),
        "total": int(state.get("total", 0)),
        "processed": int(state.get("processed", 0)),
        "updated": int(state.get("updated", 0)),
    }


def get_fetch_status(prefix):
    return _public_state(_fetch_state.get(prefix, {}))


def mark_running(prefix):
    """Synchronously flag a prefix as running so the launching route can return
    immediately and dedupe concurrent starts before the task is scheduled."""
    state = _fetch_state.setdefault(prefix, {})
    state.update({"running": True, "total": 0, "processed": 0, "updated": 0})


async def fetch_all_civitai(prefix, force=False):
    """Hash + look up every model that needs metadata; write LM-style sidecars.

    Concurrency-limited and runs hashing off the event loop. Idempotent: only
    models without Civitai metadata (or, with ``force``, all of them) are
    processed. Intended to be launched as a background task — callers poll
    ``get_fetch_status`` for progress.
    """
    import aiohttp

    if prefix not in PREFIX_FOLDER_KEYS:
        return {"error": "unknown prefix"}

    state = _fetch_state.setdefault(prefix, {})
    state["running"] = True

    # Walk the library once and set `total` to the file count up front, so the
    # progress indicator shows a real denominator immediately and animates as
    # each file is examined — rather than sitting at 0/0 while the "which models
    # need fetching" scan runs (which reads every sidecar + preview and can be
    # slow on a large library). Files that already have metadata are skipped
    # cheaply by _needs_fetch; only the few that need it pay the hash + lookup.
    all_files = list(_iter_model_files(prefix))
    state.update({"running": True, "total": len(all_files),
                  "processed": 0, "updated": 0})

    sem = asyncio.Semaphore(CIVITAI_CONCURRENCY)
    headers = {"User-Agent": "comfyui-mobile-frontend"}

    try:
        async with aiohttp.ClientSession(headers=headers) as session:
            async def worker(model_path, sub_type):
                # Yield first so the event loop can serve fetch-status polls
                # between files (the _needs_fetch sidecar/preview reads are sync).
                await asyncio.sleep(0)
                ok = False
                try:
                    if force or _needs_fetch(model_path):
                        ok = await _populate_model(session, model_path, sub_type, sem)
                except Exception as exc:
                    logger.warning("Populate failed for %s: %s", model_path, exc)
                state["processed"] += 1
                if ok:
                    state["updated"] = int(state.get("updated", 0)) + 1
                return ok

            await asyncio.gather(
                *(worker(path, sub_type)
                  for path, _root, sub_type in all_files)
            )
    finally:
        state["running"] = False

    return {
        "success": True,
        "processed": state["processed"],
        "updated": state["updated"],
        "total": len(all_files),
    }
