from mobile_routes_system import _count_history


def test_count_history_counts_runs_from_hidden_workflows():
    history = {
        "a": {"prompt": (0, "a", {}, {"mobile_hidden_workflow": True}, [])},
        "b": {"prompt": (1, "b", {}, {}, [])},
        "c": {"prompt": (2, "c", {}, {"mobile_hidden_workflow": False}, [])},
    }

    assert _count_history(history) == (3, 1)
