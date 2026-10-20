#!/usr/bin/env python3
"""Measure uncached preview rendering in fresh processes, without ComfyUI.

Uses synthetic solid-color PNGs; useful for decoded-pixel memory, not typical
photo encoding time or compression ratios. Run with ComfyUI's Python.
"""
import argparse
import json
import resource
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--worker', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--edge', type=int, default=2048)
    args = parser.parse_args()
    if args.worker:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import mobile_image_preview
        started = time.monotonic()
        cpu = time.process_time()
        data = mobile_image_preview.render(str(args.worker), args.edge)
        print(json.dumps({'output_edge': args.edge,
                          'wall_seconds': time.monotonic() - started,
                          'cpu_seconds': time.process_time() - cpu,
                          'peak_process_rss_mib_linux': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
                          'encoded_bytes': len(data)}))
        return
    if args.output is None:
        parser.error('--output is required')
    from PIL import Image
    results = []
    with tempfile.TemporaryDirectory(prefix='cueforge-media-profile-') as directory:
        for size in [4096, 8192]:
            path = Path(directory) / f'{size}.png'
            with Image.new('RGB', (size, size), (120, 80, 160)) as image:
                image.save(path)
            for edge in [512, 2048]:
                run = subprocess.run([sys.executable, __file__, '--worker', str(path), '--edge', str(edge)],
                                     check=True, capture_output=True, text=True)
                result = {'source_size': [size, size], **json.loads(run.stdout)}
                results.append(result)
                print(json.dumps(result), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'results': results,
        'limitations': 'Fresh process per render, Linux peak RSS, single request, solid RGB PNGs, no cache. Not added memory in a running ComfyUI process and not representative encoding time for photos.'}, indent=2) + '\n')


if __name__ == '__main__':
    main()
