import concurrent.futures
import os
import struct
import time

import pytest

import mobile_video_playback as playback


COMPATIBLE_STREAMS = [
    {'codec_type': 'video', 'codec_name': 'h264', 'pix_fmt': 'yuv420p'},
    {'codec_type': 'audio', 'codec_name': 'aac'},
]
INCOMPATIBLE_STREAMS = [
    {'codec_type': 'video', 'codec_name': 'vp9', 'pix_fmt': 'yuv420p'},
    {'codec_type': 'audio', 'codec_name': 'opus'},
]


def _box(box_type, payload=b''):
    return struct.pack('>I4s', len(payload) + 8, box_type) + payload


def _write_mp4(path, *, faststart):
    ftyp = _box(b'ftyp', b'isom0000')
    moov = _box(b'moov', b'index')
    mdat = _box(b'mdat', b'video-payload')
    path.write_bytes(ftyp + (moov + mdat if faststart else mdat + moov))


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    cache = tmp_path / 'cache'
    cache.mkdir()
    monkeypatch.setattr(playback, '_cache_dir', lambda: str(cache))
    # These tests cover the orchestration (caching, locking, mode files) using
    # synthetic MP4 bytes no real decoder would accept, so the child process is
    # stubbed via _run_worker. PyAV itself must still report as present, or
    # get_or_prepare short-circuits to serving the file unprepared. The real
    # worker has its own end-to-end tests below, on genuinely encoded files.
    monkeypatch.setattr(playback, 'pyav_module', lambda: object())
    playback._known_originals.clear()
    return cache


def _install_fake_worker(monkeypatch, calls, *, delay=0):
    """Stand in for the child process: record the call and write the output.

    Preparation runs out of process (mobile_video_worker.py) so a libav crash
    can't take ComfyUI down; these tests exercise the orchestration around it —
    caching, locking, mode files — against synthetic MP4 boxes no real decoder
    would accept, so the child itself is stubbed here.
    """
    def fake_run(mode, file_path, output_path):
        calls.append((mode, file_path, output_path))
        if delay:
            time.sleep(delay)
        _write_mp4(os_path(output_path), faststart=True)

    monkeypatch.setattr(playback, '_run_worker', fake_run)


def os_path(value):
    from pathlib import Path
    return Path(value)


def test_detects_front_loaded_mp4_index(tmp_path):
    front = tmp_path / 'front.mp4'
    back = tmp_path / 'back.mp4'
    _write_mp4(front, faststart=True)
    _write_mp4(back, faststart=False)

    assert playback._is_faststart_mp4(front)
    assert not playback._is_faststart_mp4(back)


def test_serves_compatible_faststart_mp4_without_copying(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'ready.mp4'
    _write_mp4(source, faststart=True)
    probes = []
    monkeypatch.setattr(
        playback,
        '_probe_media',
        lambda path: probes.append(path) or COMPATIBLE_STREAMS,
    )
    monkeypatch.setattr(
        playback,
        '_run_worker',
        lambda *_args: pytest.fail('no preparation should run for a ready MP4'),
    )

    result = playback.get_or_prepare(str(source))
    again = playback.get_or_prepare(str(source))

    assert result.path == str(source)
    assert result.mode == 'original'
    assert again == result
    assert probes == [str(source)]


def test_losslessly_remuxes_compatible_late_index_video_and_reuses_cache(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'late.mp4'
    _write_mp4(source, faststart=False)
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands)

    first = playback.get_or_prepare(str(source))
    second = playback.get_or_prepare(str(source))

    assert first == second
    assert first.mode == 'remux'
    assert playback._is_faststart_mp4(first.path)
    assert len(commands) == 1
    assert commands[0][0] == 'remux'


def test_transcodes_incompatible_formats_to_h264_aac(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'source.webm'
    source.write_bytes(b'webm source')
    monkeypatch.setattr(playback, '_probe_media', lambda _path: INCOMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands)

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'transcode'
    assert commands[0][0] == 'transcode'


def test_falls_back_to_transcode_when_stream_copy_fails(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'late.mov'
    source.write_bytes(b'mov source')
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    commands = []

    def fake_run(mode, file_path, output_path):
        commands.append((mode, file_path, output_path))
        if len(commands) == 1:
            raise playback.PlaybackPreparationError('copy rejected')
        _write_mp4(os_path(output_path), faststart=True)

    monkeypatch.setattr(playback, '_run_worker', fake_run)

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'transcode'
    assert [call[0] for call in commands] == ['remux', 'transcode']


def test_concurrent_cache_misses_start_only_one_worker_process(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'late.mp4'
    _write_mp4(source, faststart=False)
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands, delay=0.05)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(
            lambda _index: playback.get_or_prepare(str(source)),
            range(6),
        ))

    assert len(commands) == 1
    assert len({result.path for result in results}) == 1
    assert {result.mode for result in results} == {'remux'}


def test_cache_key_changes_when_source_changes(tmp_path, isolated_cache, monkeypatch):
    source = tmp_path / 'late.mp4'
    _write_mp4(source, faststart=False)
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands)

    first = playback.get_or_prepare(str(source))
    source.write_bytes(source.read_bytes() + b'changed')
    second = playback.get_or_prepare(str(source))

    assert first.path != second.path
    assert len(commands) == 2


def test_prune_cache_enforces_count_and_removes_mode_sidecars(
    isolated_cache, monkeypatch
):
    paths = []
    for index in range(3):
        path = isolated_cache / ('{}.mp4'.format(index))
        path.write_bytes(b'x' * 10)
        mode_path = isolated_cache / ('{}.mp4.mode'.format(index))
        mode_path.write_text('remux', encoding='utf-8')
        # Clearly cold: recent files are protected by the eviction grace window
        # that keeps an in-flight cache hit from being unlinked mid-serve.
        timestamp = time.time() - (3600 - index)
        os.utime(path, (timestamp, timestamp))
        paths.append(path)

    playback.prune_cache(max_bytes=100, max_files=2)

    assert not paths[0].exists()
    assert not os_path(str(paths[0]) + '.mode').exists()
    assert paths[1].exists()
    assert paths[2].exists()


def _missing_executable(name):
    raise playback.PlaybackPreparationError('{} not installed'.format(name))


def test_serves_the_original_when_pyav_is_missing(
    tmp_path, isolated_cache, monkeypatch
):
    # PyAV is the only requirement, but a stripped environment can lack it. Every
    # local video is routed through this gateway, so refusing would make files
    # that played fine in 3.0.x unplayable — serve the bytes and let the browser
    # decide instead.
    source = tmp_path / 'plain.mp4'
    _write_mp4(source, faststart=True)
    monkeypatch.setattr(playback, 'pyav_module', lambda: None)
    monkeypatch.setattr(
        playback,
        '_run_worker',
        lambda *_args: pytest.fail('nothing should be prepared when PyAV is absent'),
    )

    result = playback.get_or_prepare(str(source))

    assert result.path == str(source)
    assert result.mode == 'unprepared'


def test_unprepared_fallback_is_not_cached_as_an_original(
    tmp_path, isolated_cache, monkeypatch
):
    # Installing PyAV later must take effect without restarting ComfyUI, so the
    # unprepared answer is deliberately not remembered.
    source = tmp_path / 'late.mp4'
    _write_mp4(source, faststart=False)
    monkeypatch.setattr(playback, 'pyav_module', lambda: None)
    assert playback.get_or_prepare(str(source)).mode == 'unprepared'

    monkeypatch.setattr(playback, 'pyav_module', lambda: object())
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands)

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'remux'
    assert commands, 'preparation should run once PyAV becomes available'


def test_serves_the_original_when_pyav_cannot_do_the_job(
    tmp_path, isolated_cache, monkeypatch
):
    # PyAV present but built without an H.264 encoder. Serving the original still
    # plays wherever the browser understands the codec; refusing guarantees it
    # plays nowhere.
    source = tmp_path / 'source.webm'
    source.write_bytes(b'webm source')
    monkeypatch.setattr(playback, '_probe_media', lambda _path: INCOMPATIBLE_STREAMS)

    def unavailable(*_args):
        raise playback.PreparationUnavailable('no H.264 encoder')

    monkeypatch.setattr(playback, '_run_worker', unavailable)

    result = playback.get_or_prepare(str(source))

    assert result.path == str(source)
    assert result.mode == 'unprepared'


def test_still_prepares_normally_when_pyav_is_present(
    tmp_path, isolated_cache, monkeypatch
):
    source = tmp_path / 'incompatible.webm'
    source.write_bytes(b'not-an-mp4')
    monkeypatch.setattr(playback, '_probe_media', lambda _path: INCOMPATIBLE_STREAMS)
    commands = []
    _install_fake_worker(monkeypatch, commands)

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'transcode'
    assert len(commands) == 1


# --- Out-of-process worker ----------------------------------------------
# Preparation decodes untrusted media, where a malformed file can crash libav.
# Running it in a child process means that crash — and a run that never
# finishes — is recoverable instead of taking ComfyUI down mid-generation.

def _worker_script(tmp_path, body):
    script = tmp_path / 'fake_worker.py'
    script.write_text(body)
    return str(script)


def test_worker_timeout_is_killed_and_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(playback, 'PREPARE_TIMEOUT_SECONDS', 1)
    monkeypatch.setattr(
        playback, '_WORKER_PATH',
        _worker_script(tmp_path, 'import time\ntime.sleep(120)\n'),
    )

    with pytest.raises(playback.PlaybackPreparationError, match='timed out'):
        playback._run_worker('remux', 'in.mp4', 'out.mp4')


def test_worker_crash_does_not_take_down_the_caller(tmp_path, monkeypatch):
    # A real SIGSEGV, the failure mode in-process preparation cannot survive.
    monkeypatch.setattr(
        playback, '_WORKER_PATH',
        _worker_script(tmp_path, 'import ctypes\nctypes.string_at(0)\n'),
    )

    with pytest.raises(playback.PlaybackPreparationError, match='killed by signal'):
        playback._run_worker('remux', 'in.mp4', 'out.mp4')


def test_worker_reports_unavailable_distinctly(tmp_path, monkeypatch):
    monkeypatch.setattr(
        playback, '_WORKER_PATH',
        _worker_script(tmp_path, 'import sys\nsys.exit(3)\n'),
    )

    with pytest.raises(playback.PreparationUnavailable):
        playback._run_worker('remux', 'in.mp4', 'out.mp4')


# --- PyAV backend, end to end -------------------------------------------
# These run the REAL worker subprocess against genuinely encoded files (unlike
# the synthetic boxes above, which no decoder would accept).

# NOT pytest.importorskip at module level: that raises Skipped with
# allow_module_level, so a runner without PyAV skips this ENTIRE file —
# including the orchestration tests above, which stub PyAV out and need no
# decoder at all. The suite would still report green while the cache, lock and
# fallback coverage silently stopped running.
try:  # pragma: no cover - depends on the runner
    import av
    import numpy as np
    _HAVE_PYAV = True
except Exception:  # pragma: no cover
    av = None
    np = None
    _HAVE_PYAV = False

requires_pyav = pytest.mark.skipif(
    not _HAVE_PYAV, reason='PyAV/numpy not installed on this runner'
)


@pytest.fixture
def pyav_cache(tmp_path, monkeypatch):
    cache = tmp_path / 'pyav-cache'
    cache.mkdir()
    monkeypatch.setattr(playback, '_cache_dir', lambda: str(cache))
    playback._known_originals.clear()
    return cache


def _encode(path, *, faststart, pix_fmt='yuv420p', frames=6):
    options = {'movflags': 'faststart'} if faststart else {}
    with av.open(str(path), 'w', options=options) as container:
        stream = container.add_stream('libx264', rate=10)
        stream.width, stream.height, stream.pix_fmt = 64, 64, pix_fmt
        for i in range(frames):
            shade = (i * 30) % 255
            frame = av.VideoFrame.from_ndarray(
                np.full((64, 64, 3), shade, dtype=np.uint8), format='rgb24'
            )
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


@requires_pyav
def test_probes_streams_in_process(tmp_path, pyav_cache):
    source = tmp_path / 'probe.mp4'
    _encode(source, faststart=True)

    streams = playback._probe_media(str(source))

    assert playback._is_browser_compatible(streams)
    assert streams[0]['codec_name'] == 'h264'
    assert streams[0]['pix_fmt'] == 'yuv420p'


@requires_pyav
def test_pyav_serves_a_ready_faststart_mp4_untouched(tmp_path, pyav_cache):
    source = tmp_path / 'ready.mp4'
    _encode(source, faststart=True)

    result = playback.get_or_prepare(str(source))

    assert result.path == str(source)
    assert result.mode == 'original'


@requires_pyav
def test_pyav_remuxes_a_late_index_mp4_losslessly(tmp_path, pyav_cache):
    source = tmp_path / 'late.mp4'
    _encode(source, faststart=False)
    assert not playback._is_faststart_mp4(str(source))

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'remux'
    assert result.path != str(source)
    assert playback._is_faststart_mp4(result.path)
    # Stream copy, not a re-encode: the picture data is carried over as-is.
    assert playback._probe_media(result.path)[0]['codec_name'] == 'h264'


@requires_pyav
def test_pyav_transcodes_an_incompatible_pixel_format(tmp_path, pyav_cache):
    # yuv444p decodes fine but browsers won't play it, so this must be re-encoded
    # rather than copied.
    source = tmp_path / 'odd.mp4'
    _encode(source, faststart=True, pix_fmt='yuv444p')
    assert not playback._is_browser_compatible(playback._probe_media(str(source)))

    result = playback.get_or_prepare(str(source))

    assert result.mode == 'transcode'
    streams = playback._probe_media(result.path)
    assert streams[0]['pix_fmt'] == 'yuv420p'
    assert playback._is_faststart_mp4(result.path)


@requires_pyav
def test_preparation_needs_only_pyav(monkeypatch):
    # No external binary is consulted at all — PyAV alone decides.
    assert playback._preparation_possible()

    monkeypatch.setattr(playback, 'pyav_module', lambda: None)
    assert not playback._preparation_possible()


def test_cache_hit_marks_the_file_recently_used_without_touching_mtime(
    tmp_path, isolated_cache, monkeypatch
):
    # Recency must NOT be recorded by touching the file: aiohttp derives its
    # ETag from st_mtime_ns and compares If-Range against the mtime, so a touch
    # per request would break 304s and turn every seek into a full 200 body.
    source = tmp_path / 'late.mp4'
    _write_mp4(source, faststart=False)
    monkeypatch.setattr(playback, '_probe_media', lambda _path: COMPATIBLE_STREAMS)
    _install_fake_worker(monkeypatch, [])
    prepared = playback.get_or_prepare(str(source))
    mtime_before = os.stat(prepared.path).st_mtime_ns

    playback._known_originals.clear()
    playback._recently_used.clear()
    playback.get_or_prepare(str(source))

    assert os.stat(prepared.path).st_mtime_ns == mtime_before
    assert prepared.path in playback._recently_used


def test_prune_does_not_evict_a_file_being_served(tmp_path, isolated_cache, monkeypatch):
    # get_or_prepare hands back a PATH and aiohttp opens it later on the event
    # loop, so a just-resolved cache hit may not be open yet. Evicting it turns a
    # fully prepared video into "unable to play".
    in_flight = isolated_cache / 'in-flight.mp4'
    _write_mp4(in_flight, faststart=True)
    other = isolated_cache / 'other.mp4'
    _write_mp4(other, faststart=True)
    playback._recently_used[str(in_flight)] = time.time()
    playback._recently_used[str(other)] = time.time() - 10 ** 4

    # Bounds of zero: everything is over budget and eligible for eviction.
    playback.prune_cache(current_path=None, max_bytes=0, max_files=0)

    assert in_flight.exists(), 'a freshly touched file must survive eviction'
    assert not other.exists(), 'a cold file is still evicted'


def test_a_failing_preparation_is_attempted_once_not_per_byte_range(
    tmp_path, isolated_cache, monkeypatch
):
    # The browser fetches a video in byte ranges. Re-attempting on each one
    # means a full probe plus a fresh worker per range, all serialized behind
    # the same lock and each able to hold the executor for the whole timeout —
    # one bad file would stall the rest of the mobile API.
    source = tmp_path / 'broken.mp4'
    _write_mp4(source, faststart=False)
    attempts = []

    def failing_worker(mode, file_path, output_path):
        attempts.append(mode)
        raise playback.PlaybackPreparationError('decode failed')

    monkeypatch.setattr(playback, '_run_worker', failing_worker)

    first = playback.get_or_prepare(str(source))
    second = playback.get_or_prepare(str(source))
    third = playback.get_or_prepare(str(source))

    assert len(attempts) == 1
    for result in (first, second, third):
        assert result.path == str(source)
        assert result.mode == 'unprepared'


def test_an_unprepared_original_keeps_its_own_mode_on_replay(
    tmp_path, isolated_cache, monkeypatch
):
    # Mode drives Content-Type: replaying an unprepared webm as 'original'
    # stamps video/mp4 on it, and an engine that accepted the first response
    # stops playing when the type contradicts it mid-stream.
    source = tmp_path / 'clip.webm'
    _write_mp4(source, faststart=False)

    def unavailable(mode, file_path, output_path):
        raise playback.PreparationUnavailable('no h264 encoder')

    monkeypatch.setattr(playback, '_run_worker', unavailable)

    assert playback.get_or_prepare(str(source)).mode == 'unprepared'
    assert playback.get_or_prepare(str(source)).mode == 'unprepared'
