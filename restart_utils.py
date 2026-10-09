import sys


def build_restart_exec_args() -> tuple[str, list[str]]:
    """Restart with the running interpreter, preserving the original launch arguments.

    sys.orig_argv[0] is not reused: a Windows venv launcher re-executes the base
    interpreter, so orig_argv[0] names the base Python while sys.executable is
    the venv one.
    """
    executable = sys.executable
    original_argv = getattr(sys, "orig_argv", None)
    if isinstance(original_argv, list) and original_argv and all(
        isinstance(arg, str) for arg in original_argv
    ):
        return executable, [executable, *original_argv[1:]]

    return executable, [executable, *sys.argv]
