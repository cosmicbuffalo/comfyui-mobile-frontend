import os
import sys


def build_restart_exec_args() -> tuple[str, list[str]]:
    """Preserve the original Python invocation when restarting the process."""
    original_argv = getattr(sys, "orig_argv", None)
    if isinstance(original_argv, list) and original_argv and all(
        isinstance(arg, str) for arg in original_argv
    ):
        executable = original_argv[0]
        if not executable or not os.path.isabs(executable):
            executable = sys.executable
        return executable, [executable, *original_argv[1:]]

    executable = sys.executable
    return executable, [executable, *sys.argv]
