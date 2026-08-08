"""Prepare browser-friendly video files for reliable ranged playback.

Mobile WebKit is especially sensitive to MP4s whose ``moov`` index sits after
the media payload: it commonly cancels an initial full-file request, asks for a
tail range, and then starts over.  This module gives the mobile frontend one
stable playback format without modifying generated originals:

* H.264/yuv420p MP4s that already have a front-loaded index are served as-is.
* Compatible files with a late index are losslessly remuxed with faststart.
* Other formats are transcoded to H.264/AAC MP4 with a front-loaded index.

Prepared files live in ComfyUI's temp directory, are keyed by source identity,
are written atomically, and are bounded by both count and total bytes.
"""

from dataclasses import dataclass
import hashlib
import json
import os
import struct
import subprocess
import sys
import threading
import time

import binary_cache_io as _binary_cache_io


_LOG_PREFIX = "[\033[34mMobile Video\033[0m]"

VIDEO_EXTENSIONS = frozenset(('.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'))
CACHE_VERSION = 'v1'
CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024
CACHE_MAX_FILES = 256
# Grace window protecting a just-resolved cache hit from eviction before the
# response has opened it.
_EVICTION_GRACE_SECONDS = 60
PREPARE_TIMEOUT_SECONDS = 30 * 60

_DIRECT_MP4_EXTENSIONS = frozenset(('.mp4', '.m4v'))
_BROWSER_VIDEO_CODECS = frozenset(('h264',))
_BROWSER_PIXEL_FORMATS = frozenset(('yuv420p', 'yuvj420p'))
_BROWSER_AUDIO_CODECS = frozenset(('aac', 'mp3'))
_prune_lock = threading.Lock()
_recent_lock = threading.Lock()
# cache path -> monotonic-ish last-served time. In memory because the on-disk
# mtime is load-bearing for HTTP caching (see _read_cached).
_recently_used: dict[str, float] = {}
_RECENTLY_USED_MAX = 4096
_originals_lock = threading.Lock()
_known_originals = {}
_KNOWN_ORIGINALS_MAX = 4096


class PlaybackPreparationError(RuntimeError):
    """Raised when a source cannot be converted into the playback format."""


@dataclass(frozen=True)
class PlayableVideo:
    path: str
    mode: str


def is_video(filename):
    return os.path.splitext(filename)[1].lower() in VIDEO_EXTENSIONS


def _cache_dir():
    import folder_paths

    path = os.path.join(folder_paths.get_temp_directory(), 'mobile_playable_videos')
    os.makedirs(path, exist_ok=True)
    return path


def _source_identity(file_path):
    stat = os.stat(file_path)
    return '{}|{}|{}|{}'.format(
        CACHE_VERSION,
        os.path.abspath(file_path),
        stat.st_mtime_ns,
        stat.st_size,
    )


def _cache_path(file_path, source_identity=None):
    identity = source_identity if source_identity is not None else _source_identity(file_path)
    digest = hashlib.sha256(identity.encode('utf-8')).hexdigest()
    return os.path.join(_cache_dir(), digest + '.mp4')


def _known_original_mode(source_identity):
    """The mode a previously-resolved original must keep being served with.

    Returns None when this source has not been resolved to an original.
    """
    with _originals_lock:
        return _known_originals.get(source_identity)


def _remember_original(source_identity, mode):
    """Memoize "serve this source as-is", together with the mode to serve it in.

    The mode has to ride along: 'original' is a faststart MP4, while
    'unprepared' can be webm/mkv/mov/avi, and the HTTP layer picks
    Content-Type from that distinction. Replaying an unprepared webm as
    'original' would stamp video/mp4 on it mid-stream and the browser would
    stop playing a file it had already accepted.
    """
    with _originals_lock:
        if len(_known_originals) >= _KNOWN_ORIGINALS_MAX and source_identity not in _known_originals:
            # Drop the oldest quarter rather than the whole map: a wipe sends
            # every in-flight video back through a full probe at once.
            for stale in list(_known_originals)[: max(1, _KNOWN_ORIGINALS_MAX // 4)]:
                del _known_originals[stale]
        _known_originals[source_identity] = mode


def _mode_path(cache_path):
    return cache_path + '.mode'


def _mark_recently_used(cache_path):
    with _recent_lock:
        if len(_recently_used) >= _RECENTLY_USED_MAX and cache_path not in _recently_used:
            # Evict the oldest quarter, never the whole map: wiping it drops
            # every entry back to its mtime, which is when the file was
            # prepared — so prune_cache could delete a video that was resolved
            # seconds ago and is still waiting to be opened on the event loop.
            for stale in sorted(_recently_used, key=_recently_used.get)[
                : max(1, _RECENTLY_USED_MAX // 4)
            ]:
                del _recently_used[stale]
        _recently_used[cache_path] = time.time()


def _last_used(cache_path, fallback_mtime_ns):
    with _recent_lock:
        served = _recently_used.get(cache_path)
    if served is not None:
        return served
    # Clamp the mtime fallback to now. prune_cache skips anything newer than its
    # grace cutoff, so a future-dated mtime — a clock step, or a file restored
    # from a machine whose clock was ahead — would make that entry permanently
    # unevictable and the cache would grow without limit.
    return min(fallback_mtime_ns / 1_000_000_000, time.time())


def _read_cached(cache_path):
    try:
        if not os.path.isfile(cache_path) or os.path.getsize(cache_path) <= 0:
            return None
        # Recency is tracked in memory, NOT by touching the file: aiohttp builds
        # its ETag from st_mtime_ns and compares If-Range against the file's
        # mtime, so rewriting it on every read would break 304 revalidation and
        # turn every seek into a full 200 body — on exactly the remote-playback
        # path this cache exists to smooth.
        _mark_recently_used(cache_path)
        mode = 'cached'
        try:
            with open(_mode_path(cache_path), 'r', encoding='utf-8') as handle:
                cached_mode = handle.read().strip()
            if cached_mode in ('remux', 'transcode'):
                mode = cached_mode
        except OSError:
            pass
        return PlayableVideo(cache_path, mode)
    except OSError:
        return None


def _preparation_possible():
    """True when this install can prepare a video at all.

    ComfyUI ships PyAV, and that is the only thing this module needs — there is
    deliberately no external CLI dependency. When PyAV is missing the caller
    serves the original bytes rather than refusing every video.
    """
    return pyav_module() is not None



_missing_tools_warned = False


def _warn_missing_tools_once():
    """Say why videos are being served unprepared — once, not per request."""
    global _missing_tools_warned
    if _missing_tools_warned:
        return
    _missing_tools_warned = True
    print(
        '{} PyAV cannot prepare videos here — serving them as-is. Videos in '
        'formats your browser handles will still play.'.format(_LOG_PREFIX)
    )


def pyav_module():
    """Return the PyAV module, or None when it isn't importable.

    ComfyUI already depends on PyAV (its own video nodes use it), so this is the
    zero-new-dependency path: no external binary is required, and preparation
    runs in a child process (mobile_video_worker.py) for crash isolation.
    """
    try:
        import av
    except Exception:
        return None
    return av


def _pyav_probe(file_path):
    """Stream list (codec_type/codec_name/pix_fmt) via PyAV, or None."""
    av = pyav_module()
    if av is None:
        return None
    try:
        with av.open(file_path) as container:
            streams = []
            for stream in container.streams:
                # Per-stream, not all-or-nothing: a timecode/data/attachment
                # track has no codec_context, and letting that sink the whole
                # probe reports an unprobeable file, which _is_browser_compatible
                # reads as incompatible — sending a perfectly playable MP4
                # through a full re-encode instead of the serve-as-is fast path.
                try:
                    codec_context = stream.codec_context
                    streams.append({
                        'codec_type': stream.type,
                        'codec_name': codec_context.name,
                        'pix_fmt': getattr(codec_context, 'pix_fmt', None),
                    })
                except Exception:
                    streams.append({
                        'codec_type': getattr(stream, 'type', None),
                        'codec_name': None,
                        'pix_fmt': None,
                    })
            return streams
    except Exception:
        return None


def _pyav_mapped_streams(container):
    """First video + first audio stream, mirroring `-map 0:v:0 -map 0:a:0? -sn -dn`."""
    video = next((s for s in container.streams if s.type == 'video'), None)
    audio = next((s for s in container.streams if s.type == 'audio'), None)
    return [s for s in (video, audio) if s is not None]


def pyav_remux(av, file_path, output_path):
    with av.open(file_path) as source:
        mapped = _pyav_mapped_streams(source)
        if not mapped:
            raise PlaybackPreparationError('source has no video stream to remux')
        # movflags=faststart is the muxer's own second pass, so the index
        # lands up front.
        with av.open(output_path, 'w', options={'movflags': 'faststart'}) as target:
            out_streams = {
                stream.index: target.add_stream_from_template(stream)
                for stream in mapped
            }
            for packet in source.demux(*mapped):
                # Flush packets carry no timestamps and must not be muxed.
                if packet.dts is None:
                    continue
                packet.stream = out_streams[packet.stream.index]
                target.mux(packet)
    return True


def pyav_h264_encoder(av):
    for name in ('libx264', 'libopenh264', 'h264'):
        try:
            av.codec.Codec(name, 'w')
            return name
        except Exception:
            continue
    return None


def pyav_transcode(av, encoder, file_path, output_path):
    with av.open(file_path) as source:
        video_in = next((s for s in source.streams if s.type == 'video'), None)
        if video_in is None:
            raise PlaybackPreparationError('source has no video stream to transcode')
        audio_in = next((s for s in source.streams if s.type == 'audio'), None)
        with av.open(output_path, 'w', options={'movflags': 'faststart'}) as target:
            # H.264 requires even dimensions, so frames are reformatted on the
            # way in (the equivalent of scale=trunc(iw/2)*2).
            width = (video_in.codec_context.width // 2) * 2
            height = (video_in.codec_context.height // 2) * 2
            if width <= 0 or height <= 0:
                raise PlaybackPreparationError('source video has no usable dimensions')
            video_out = target.add_stream(encoder, rate=video_in.average_rate or 30)
            video_out.width = width
            video_out.height = height
            video_out.pix_fmt = 'yuv420p'
            audio_out = target.add_stream('aac') if audio_in is not None else None

            for packet in source.demux(*[s for s in (video_in, audio_in) if s]):
                if packet.dts is None:
                    continue
                if packet.stream is video_in:
                    for frame in packet.decode():
                        frame = frame.reformat(width=width, height=height, format='yuv420p')
                        for out_packet in video_out.encode(frame):
                            target.mux(out_packet)
                elif audio_out is not None:
                    for frame in packet.decode():
                        frame.pts = None
                        for out_packet in audio_out.encode(frame):
                            target.mux(out_packet)
            for out_packet in video_out.encode():
                target.mux(out_packet)
            if audio_out is not None:
                for out_packet in audio_out.encode():
                    target.mux(out_packet)
    return True


def _probe_media(file_path):
    """Return the stream list, or None when the source cannot be read."""
    return _pyav_probe(file_path)



def _is_browser_compatible(streams):
    if not streams:
        return False
    video = next(
        (stream for stream in streams if stream.get('codec_type') == 'video'),
        None,
    )
    if video is None:
        return False
    if video.get('codec_name') not in _BROWSER_VIDEO_CODECS:
        return False
    if video.get('pix_fmt') not in _BROWSER_PIXEL_FORMATS:
        return False
    return all(
        stream.get('codec_name') in _BROWSER_AUDIO_CODECS
        for stream in streams
        if stream.get('codec_type') == 'audio'
    )


def _is_faststart_mp4(file_path):
    """Return True when a top-level MP4 ``moov`` box precedes ``mdat``.

    Box payloads are skipped with ``seek`` rather than read, so checking a large
    source costs only a few tiny reads even when its index is at the end.
    """
    try:
        file_size = os.path.getsize(file_path)
        moov_offset = None
        mdat_offset = None
        offset = 0
        with open(file_path, 'rb') as handle:
            while offset + 8 <= file_size:
                handle.seek(offset)
                header = handle.read(16)
                if len(header) < 8:
                    return False
                box_size = struct.unpack('>I', header[:4])[0]
                box_type = header[4:8]
                header_size = 8
                if box_size == 1:
                    if len(header) < 16:
                        return False
                    box_size = struct.unpack('>Q', header[8:16])[0]
                    header_size = 16
                elif box_size == 0:
                    box_size = file_size - offset
                if box_size < header_size or offset + box_size > file_size:
                    return False
                if box_type == b'moov' and moov_offset is None:
                    moov_offset = offset
                elif box_type == b'mdat' and mdat_offset is None:
                    mdat_offset = offset
                if moov_offset is not None and mdat_offset is not None:
                    return moov_offset < mdat_offset
                offset += box_size
        return False
    except OSError:
        return False


class PreparationTimeout(PlaybackPreparationError):
    """The child exceeded its wall-clock budget — do not spend another one."""


class PreparationUnavailable(RuntimeError):
    """PyAV can't do this job here — the caller serves the original bytes."""


_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile_video_worker.py')
_WORKER_EXIT_UNAVAILABLE = 3


def _run_worker(mode, file_path, output_path):
    """Prepare in a child process; return on success, raise on failure.

    Out of process for two reasons in-process work cannot provide: a libav crash
    on a malformed file kills the child rather than ComfyUI mid-generation, and a
    run that never finishes can actually be killed (a Python thread cannot). The
    child is this same interpreter, so PyAV is the only requirement — there is no
    external binary to install.
    """
    try:
        result = subprocess.run(
            [sys.executable, _WORKER_PATH, mode, file_path, output_path],
            check=False,
            capture_output=True,
            text=True,
            timeout=PREPARE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise PreparationTimeout('preparing the video timed out') from exc
    except OSError as exc:
        raise PlaybackPreparationError('could not start the video worker') from exc

    if result.returncode == 0:
        return
    if result.returncode == _WORKER_EXIT_UNAVAILABLE:
        raise PreparationUnavailable('PyAV cannot prepare this video here')

    detail = (result.stderr or '').strip().replace('\n', ' ')
    if len(detail) > 800:
        detail = detail[-800:]
    # A negative code means a signal: the child died, e.g. a decoder segfault on
    # malformed media. That is precisely the crash this process no longer takes.
    message = (
        'video worker was killed by signal {}'.format(-result.returncode)
        if result.returncode < 0
        else 'video worker exited with status {}'.format(result.returncode)
    )
    if detail:
        message += ': ' + detail
    raise PlaybackPreparationError(message)


def _remux(file_path, output_path):
    _run_worker('remux', file_path, output_path)


def _transcode(file_path, output_path):
    _run_worker('transcode', file_path, output_path)



def _prepare_into(mode, file_path, tmp_path):
    """Run the chosen preparation into ``tmp_path``; return the mode used.

    A remux that fails falls back to a full re-encode: probe data can be
    incomplete, and some nominally compatible streams still cannot be copied
    into MP4. PreparationUnavailable is not that case — it means PyAV can't do
    the work at all here, so it propagates to the caller's serve-original path.
    """
    if mode == 'remux':
        try:
            _remux(file_path, tmp_path)
            return 'remux'
        except PreparationUnavailable:
            raise
        except PreparationTimeout:
            # Retrying as a transcode would grant a SECOND full budget, so one
            # request could hold an executor thread and this path's render lock
            # for twice PREPARE_TIMEOUT_SECONDS while every other mobile
            # endpoint shares that pool. A remux is the cheap operation; if it
            # ran out of time, a full re-encode certainly will too.
            raise
        except PlaybackPreparationError:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
    _transcode(file_path, tmp_path)
    return 'transcode'


def _validate_output(output_path):
    try:
        if os.path.getsize(output_path) <= 0:
            raise PlaybackPreparationError('preparation produced an empty video')
    except OSError as exc:
        raise PlaybackPreparationError('preparation did not produce a video') from exc
    if not _is_faststart_mp4(output_path):
        raise PlaybackPreparationError('prepared MP4 does not have a front-loaded index')


def prune_cache(current_path=None, max_bytes=CACHE_MAX_BYTES, max_files=CACHE_MAX_FILES):
    """Remove the oldest prepared videos until the configured bounds are met."""
    with _prune_lock:
        cache_dir = _cache_dir()
        entries = []
        try:
            names = os.listdir(cache_dir)
        except OSError:
            return
        for name in names:
            path = os.path.join(cache_dir, name)
            if name.endswith('.mp4') and '.part.' not in name:
                try:
                    stat = os.stat(path)
                    entries.append((stat.st_mtime_ns, stat.st_size, path))
                except OSError:
                    continue
            elif '.part.' in name:
                # A hard process termination can bypass the normal finally
                # cleanup. Old partials are never playable and can be discarded.
                try:
                    if time.time() - os.path.getmtime(path) > 24 * 60 * 60:
                        os.remove(path)
                except OSError:
                    pass

        # Order by last SERVE, not by mtime: mtime is when the file was
        # prepared, so a video watched daily would otherwise be a prime target.
        entries = [
            (_last_used(path, mtime_ns), size, path) for mtime_ns, size, path in entries
        ]
        entries.sort()
        # get_or_prepare returns a PATH and aiohttp opens it later, on the event
        # loop — so a file resolved by another request may not be open yet.
        # Anything served within the grace window is in flight or hot; deleting
        # it turns a fully prepared video into "unable to play".
        cutoff = time.time() - _EVICTION_GRACE_SECONDS
        total_bytes = sum(size for _, size, _ in entries)
        total_files = len(entries)
        for last_used, size, path in entries:
            if last_used > cutoff:
                continue
            if total_files <= max_files and total_bytes <= max_bytes:
                break
            if current_path is not None and os.path.abspath(path) == os.path.abspath(current_path):
                continue
            try:
                os.remove(path)
                total_files -= 1
                total_bytes -= size
            except OSError:
                continue
            try:
                os.remove(_mode_path(path))
            except OSError:
                pass


def get_or_prepare(file_path):
    """Return a browser-playable path without modifying ``file_path``.

    Synchronous by design; aiohttp callers must use ``run_in_executor``. The
    per-cache-path lock collapses concurrent misses into one worker process.
    """
    if not is_video(file_path):
        raise PlaybackPreparationError('unsupported video file extension')
    if not os.path.isfile(file_path):
        raise PlaybackPreparationError('video file does not exist')

    source_identity = _source_identity(file_path)
    cache_path = _cache_path(file_path, source_identity)
    cached = _read_cached(cache_path)
    if cached is not None:
        return cached
    # Faststart originals have no prepared file to act as a cache-hit marker.
    # Remember their source identity in-process so a browser's follow-up range
    # requests do not each re-probe the file.
    known_mode = _known_original_mode(source_identity)
    if known_mode is not None:
        return PlayableVideo(file_path, known_mode)

    with _binary_cache_io.render_lock(cache_path):
        cached = _read_cached(cache_path)
        if cached is not None:
            return cached
        known_mode = _known_original_mode(source_identity)
        if known_mode is not None:
            return PlayableVideo(file_path, known_mode)

        # Nothing to prepare with. Serve the original bytes and let the browser
        # decide, which is exactly what 3.0.x did before this gateway existed —
        # most ComfyUI outputs are already browser-playable H.264 MP4s. Refusing
        # here would make every video unplayable on such an install, a
        # regression against files that used to play fine. Not remembered as an
        # "original", so a later PyAV install takes effect without a restart.
        if not _preparation_possible():
            _warn_missing_tools_once()
            return PlayableVideo(file_path, 'unprepared')

        streams = _probe_media(file_path)
        browser_compatible = _is_browser_compatible(streams)
        extension = os.path.splitext(file_path)[1].lower()
        if (
            extension in _DIRECT_MP4_EXTENSIONS
            and browser_compatible
            and _is_faststart_mp4(file_path)
        ):
            _remember_original(source_identity, 'original')
            return PlayableVideo(file_path, 'original')

        tmp_path = '{}.{}.{}.part.mp4'.format(
            cache_path[:-4], os.getpid(), threading.get_ident()
        )
        mode = 'remux' if browser_compatible else 'transcode'
        try:
            mode = _prepare_into(mode, file_path, tmp_path)
            _validate_output(tmp_path)
            os.replace(tmp_path, cache_path)
            _binary_cache_io.atomic_write_bytes(
                _mode_path(cache_path), mode.encode('utf-8')
            )
        except PreparationUnavailable:
            # PyAV is installed but can't do this particular job (typically a
            # build with no H.264 encoder). Serving the original still plays
            # wherever the browser understands the codec; refusing guarantees it
            # plays nowhere, which is strictly worse.
            _warn_missing_tools_once()
            # Remember it: the browser fetches this file in byte ranges, and
            # without this every range re-probes the source (a full av.open of a
            # possibly multi-GB file) and re-spawns the worker, all serialized
            # behind this same lock. Keyed by source identity, so a re-encoded
            # or replaced file is re-evaluated.
            _remember_original(source_identity, 'unprepared')
            return PlayableVideo(file_path, 'unprepared')
        except (PlaybackPreparationError, PreparationTimeout):
            # Preparation was possible but this file defeated it — a decode
            # error, a worker killed by signal, a transcode that ran past the
            # deadline, or output that failed validation. Memoize it for the
            # same reason as the branch above: the browser asks for this file in
            # byte ranges, and re-attempting on every range means a full probe
            # plus a fresh worker each time, serialized behind this lock and
            # occupying the executor for up to PREPARE_TIMEOUT_SECONDS apiece.
            # One unpreparable video would otherwise stall the whole mobile API.
            # Keyed by source identity, so a replaced file is re-evaluated, and
            # in-process only, so a restart retries.
            _remember_original(source_identity, 'unprepared')
            return PlayableVideo(file_path, 'unprepared')
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

        prune_cache(current_path=cache_path)
        return PlayableVideo(cache_path, mode)
