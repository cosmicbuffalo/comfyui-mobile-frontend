#!/usr/bin/env python3
"""Run a command with process-tree resource sampling (requires psutil).

Example: python scripts/profile-resources.py \
  --output /tmp/frontend-profile.json -- npm test

RSS sums can double-count shared pages. Sampling misses short-lived processes
and peaks between samples. These are runner measurements, not app requirements.
"""

import argparse
import json
import os
import platform
import resource
import subprocess
import time
from pathlib import Path

import psutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--interval', type=float, default=0.05)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.interval <= 0:
        parser.error('provide a command after -- and a positive interval')

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    child = subprocess.Popen(command)
    root = psutil.Process(child.pid)
    samples = []
    cpu_by_process = {}
    try:
        while True:
            rss = threads = count = 0
            try:
                processes = [root, *root.children(recursive=True)]
            except psutil.Error:
                processes = []
            for process in processes:
                try:
                    identity = (process.pid, process.create_time())
                    cpu = process.cpu_times()
                    cpu_by_process[identity] = cpu.user + cpu.system
                    rss += process.memory_info().rss
                    threads += process.num_threads()
                    count += 1
                except psutil.Error:
                    continue
            samples.append({
                'seconds': round(time.monotonic() - started, 3),
                'rss_bytes': rss, 'processes': count, 'threads': threads,
            })
            if child.poll() is not None:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        child.terminate()
        child.wait()
        raise
    finally:
        elapsed = time.monotonic() - started
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        cpu_seconds = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
        report = {
            'command': command,
            'cwd': os.getcwd(),
            'platform': platform.platform(),
            'cpu_model': platform.processor(),
            'logical_cpus': os.cpu_count(),
            'host_memory_bytes': psutil.virtual_memory().total,
            'environment': {key: os.environ[key] for key in
                            ['PYTEST_DISABLE_PLUGIN_AUTOLOAD', 'NODE_OPTIONS', 'CI']
                            if key in os.environ},
            'interval_seconds': args.interval,
            'exit_code': child.returncode,
            'wall_seconds': round(elapsed, 3),
            'reaped_cpu_seconds': round(cpu_seconds, 3),
            'average_cpu_cores': round(cpu_seconds / elapsed, 3),
            'sampled_process_tree_peak_rss_mib': round(max(s['rss_bytes'] for s in samples) / 2**20, 2),
            'sampled_process_tree_cpu_seconds_lower_bound': round(sum(cpu_by_process.values()), 3),
            'peak_processes': max(s['processes'] for s in samples),
            'peak_threads': max(s['threads'] for s in samples),
            'limitations': [
                'Summed RSS double-counts shared pages; this is not proportional or unique memory.',
                'Sampling can miss transient processes and resource peaks.',
                'Reaped CPU includes descendants only when their parent waited for them.',
                'Runner consumption does not establish frontend or backend runtime requirements.',
            ],
            'samples': samples,
        }
        output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({k: v for k, v in report.items() if k != 'samples'}, indent=2))
    return child.returncode


if __name__ == '__main__':
    raise SystemExit(main())
