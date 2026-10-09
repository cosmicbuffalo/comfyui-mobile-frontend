import sys

from restart_utils import build_restart_exec_args


def test_build_restart_exec_args_preserves_original_python_invocation(monkeypatch):
    monkeypatch.setattr(
        sys,
        "orig_argv",
        ["/venv/bin/python", "-m", "comfyui.main", "--listen", "0.0.0.0"],
        raising=False,
    )
    monkeypatch.setattr(sys, "executable", "/venv/bin/python")
    monkeypatch.setattr(sys, "argv", ["main.py", "--listen", "0.0.0.0"])

    executable, argv = build_restart_exec_args()

    assert executable == "/venv/bin/python"
    assert argv == ["/venv/bin/python", "-m", "comfyui.main", "--listen", "0.0.0.0"]


def test_build_restart_exec_args_uses_venv_python_over_base_launcher(monkeypatch):
    # Windows venv launcher: orig_argv[0] is the base interpreter it re-executed.
    monkeypatch.setattr(
        sys,
        "orig_argv",
        [r"C:\Python312\python.exe", "main.py", "--listen"],
        raising=False,
    )
    monkeypatch.setattr(sys, "executable", r"C:\venv\Scripts\python.exe")
    monkeypatch.setattr(sys, "argv", ["main.py", "--listen"])

    executable, argv = build_restart_exec_args()

    assert executable == r"C:\venv\Scripts\python.exe"
    assert argv == [r"C:\venv\Scripts\python.exe", "main.py", "--listen"]


def test_build_restart_exec_args_falls_back_to_sys_argv_when_orig_argv_missing(monkeypatch):
    monkeypatch.delattr(sys, "orig_argv", raising=False)
    monkeypatch.setattr(sys, "executable", "/venv/bin/python")
    monkeypatch.setattr(sys, "argv", ["main.py", "--cpu"])

    executable, argv = build_restart_exec_args()

    assert executable == "/venv/bin/python"
    assert argv == ["/venv/bin/python", "main.py", "--cpu"]
