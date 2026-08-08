"""Out-of-process PyAV video preparation.

Run as a script (``python mobile_video_worker.py <mode> <src> <dst>``), never
imported by the server. Preparation decodes untrusted media through libav, where
a malformed file can take the interpreter down with it — in-process that would
kill ComfyUI mid-generation. A child process turns the same crash into a
non-zero exit the parent can recover from, and gives the parent a wall-clock
timeout it can actually enforce (a thread can't be killed).

This deliberately shells out to the SAME interpreter (``sys.executable``) rather
than to an external ffmpeg binary: ComfyUI ships PyAV, so there is no new
dependency and nothing to install.

Exit codes are the parent's contract:
  0  prepared successfully
  2  bad invocation
  3  PyAV cannot do this job here (missing module or no H.264 encoder)
  1  the attempt failed (message on stderr)
"""
import os
import sys

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_UNAVAILABLE = 3
EXIT_FAILED = 1


def main(argv):
    if len(argv) != 4:
        print('usage: mobile_video_worker.py <remux|transcode> <source> <output>',
              file=sys.stderr)
        return EXIT_USAGE
    mode, source, output = argv[1], argv[2], argv[3]
    if mode not in ('remux', 'transcode'):
        print('unknown mode: {}'.format(mode), file=sys.stderr)
        return EXIT_USAGE

    # The child inherits no sys.path from the parent (subprocess.run is called
    # without env=, and ComfyUI's path additions are runtime-only), so make the
    # node's own directory importable. Anything this worker needs must live
    # here or be installed in the interpreter — a ComfyUI-root import such as
    # folder_paths would NOT resolve.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import mobile_video_playback as playback

    av = playback.pyav_module()
    if av is None:
        return EXIT_UNAVAILABLE

    if mode == 'remux':
        playback.pyav_remux(av, source, output)
        return EXIT_OK

    encoder = playback.pyav_h264_encoder(av)
    if encoder is None:
        return EXIT_UNAVAILABLE
    playback.pyav_transcode(av, encoder, source, output)
    return EXIT_OK


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:  # surfaced to the parent as stderr + exit 1
        print('{}: {}'.format(type(exc).__name__, exc), file=sys.stderr)
        sys.exit(EXIT_FAILED)
