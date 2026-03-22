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


def test_build_restart_exec_args_falls_back_to_sys_argv_when_orig_argv_missing(monkeypatch):
    monkeypatch.delattr(sys, "orig_argv", raising=False)
    monkeypatch.setattr(sys, "executable", "/venv/bin/python")
    monkeypatch.setattr(sys, "argv", ["main.py", "--cpu"])

    executable, argv = build_restart_exec_args()

    assert executable == "/venv/bin/python"
    assert argv == ["/venv/bin/python", "main.py", "--cpu"]
