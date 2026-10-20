#!/usr/bin/env python3
"""Compare isolated CPU-only ComfyUI processes with and without this node.

Run with ComfyUI's existing Python environment and --comfy-root /path/to/ComfyUI.
No generation, production restart, or production data directories are involved.
Requires psutil. Results describe idle/service overhead, not inference needs.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import psutil


def get(url):
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=5) as response:
        body = response.read()
        return {'status': response.status, 'bytes': len(body),
                'ms': (time.monotonic() - started) * 1000}


def run(comfy_root, node_root, enabled, idle_seconds, artifacts):
    with tempfile.TemporaryDirectory(prefix='cueforge-backend-profile-') as directory:
        base = Path(directory)
        for name in ['custom_nodes', 'input', 'output', 'temp', 'user', 'models']:
            (base / name).mkdir()
        if enabled:
            copy = base / 'custom_nodes' / node_root.name
            copy.mkdir()
            for source in [*node_root.glob('*.py'), node_root / 'package.json', node_root / 'telemetry_contract.json']:
                shutil.copy2(source, copy / source.name)
            (copy / 'dist').symlink_to(node_root / 'dist', target_is_directory=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cmd = [sys.executable, str(comfy_root / 'main.py'), '--cpu', '--offline',
               '--disable-all-custom-nodes', '--disable-assets', '--listen', '127.0.0.1',
               '--port', str(port), '--base-directory', str(base),
               '--user-directory', str(base / 'user'), '--temp-directory', str(base / 'temp')]
        if enabled:
            cmd += ['--whitelist-custom-nodes', node_root.name]
        log_path = artifacts / ('with-node.log' if enabled else 'baseline.log')
        with log_path.open('w') as log:
            started = time.monotonic()
            child = subprocess.Popen(cmd, cwd=comfy_root, stdout=log, stderr=subprocess.STDOUT,
                                     env={**os.environ, 'COMFYUI_MOBILE_TELEMETRY': '0'})
            process = psutil.Process(child.pid)
            startup_peak = 0
            try:
                root = f'http://127.0.0.1:{port}'
                while time.monotonic() - started < 90:
                    if child.poll() is not None:
                        raise RuntimeError(f'ComfyUI exited: see {log_path}')
                    startup_peak = max(startup_peak, process.memory_info().rss)
                    try:
                        get(root + '/system_stats')
                        break
                    except (OSError, TimeoutError):
                        time.sleep(0.1)
                else:
                    raise TimeoutError(f'ComfyUI startup timed out: see {log_path}')
                startup_seconds = time.monotonic() - started
                # Let initialization finish before measuring idle CPU and memory.
                time.sleep(2)
                before = process.cpu_times()
                samples = []
                idle_start = time.monotonic()
                while time.monotonic() - idle_start < idle_seconds:
                    memory = process.memory_full_info()
                    samples.append({'rss_mib': memory.rss / 2**20,
                                    'pss_mib': getattr(memory, 'pss', 0) / 2**20,
                                    'uss_mib': getattr(memory, 'uss', 0) / 2**20})
                    time.sleep(0.2)
                after = process.cpu_times()
                idle_wall = time.monotonic() - idle_start
                cpu = after.user + after.system - before.user - before.system
                requests = {}
                paths = ['/api/object_info', '/api/queue', '/api/history']
                if enabled:
                    paths += ['/mobile/', '/mobile/api/capabilities', '/mobile/api/preferences']
                for path in paths:
                    requests[path] = get(root + path)
                return {'node_enabled': enabled, 'startup_seconds': startup_seconds,
                        'sampled_startup_peak_rss_mib': startup_peak / 2**20,
                        'idle_wall_seconds': idle_wall, 'idle_cpu_seconds': cpu,
                        'idle_cpu_one_core_percent': 100 * cpu / idle_wall,
                        'idle_samples': samples, 'requests': requests,
                        'threads': process.num_threads(), 'log': str(log_path)}
            finally:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comfy-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--idle-seconds', type=float, default=10)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    artifacts = args.output.with_suffix('')
    artifacts.mkdir(exist_ok=True)
    node_root = Path(__file__).resolve().parent.parent
    results = []
    for enabled in [False, True]:
        result = run(args.comfy_root.resolve(), node_root, enabled, args.idle_seconds, artifacts)
        results.append(result)
        print(json.dumps({k: v for k, v in result.items() if k != 'idle_samples'}), flush=True)
    args.output.write_text(json.dumps({
        'python': sys.version, 'results': results,
        'limitations': 'CPU-only, empty history/library, telemetry disabled in both; no generation, media decoding, relay targets, or other custom nodes. Memory sampled after startup. Not a system minimum.',
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
