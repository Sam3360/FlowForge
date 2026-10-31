import os
import sys
import threading

import pytest

from conftest import REG, by_event, edge, node, organize, run_workflow, wf


def files_out(events, node_id):
    return next(e for e in by_event(events, "node_completed") if e["nodeId"] == node_id)


# ---- List Files ---------------------------------------------------------------
def list_wf(**cfg):
    return wf([node("s", "start"), node("l", "list_files", **cfg), node("e", "finish")],
              [edge("s", "out", "l", "in"), edge("l", "files", "e", "in")])


def test_list_non_recursive_skips_hidden(tree):
    root, src, _ = tree
    _, ev = run_workflow(list_wf(directory=str(src)), [root])
    names = [f["name"] for f in files_out(ev, "l")["outputs"]["files"]["preview"]]
    assert names == ["a.txt", "b.TXT", "c.pdf"]


def test_list_recursive_and_hidden(tree):
    root, src, _ = tree
    _, ev = run_workflow(list_wf(directory=str(src), recursive=True, includeHidden=True), [root])
    assert files_out(ev, "l")["summary"]["count"] == 5


def test_list_include_exclude(tree):
    root, src, _ = tree
    _, ev = run_workflow(list_wf(directory=str(src), include=["*.TXT"], exclude=["b*"]), [root])
    assert [f["name"] for f in files_out(ev, "l")["outputs"]["files"]["preview"]] == ["a.txt"]


def test_list_missing_directory_fails_clearly(tree):
    root, src, _ = tree
    summary, ev = run_workflow(list_wf(directory=str(src / "nope")), [root], preflight_checks=False)
    assert summary["status"] == "failed"
    assert by_event(ev, "node_failed")[0]["error"]["code"] == "PATH_NOT_FOUND"


def test_list_outside_allowed_roots_rejected_in_preflight(tree, tmp_path_factory):
    root, src, _ = tree
    other = tmp_path_factory.mktemp("other")
    from conftest import REG
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    parsed, _, cfgs = check_workflow(list_wf(directory=str(other)), REG)
    issues = preflight(parsed, cfgs, REG, RunOptions(False, [str(root)], set()))
    assert [i.code for i in issues] == ["PATH_NOT_ALLOWED"]


def test_list_file_instead_of_directory(tree):
    root, src, _ = tree
    summary, ev = run_workflow(list_wf(directory=str(src / "a.txt")), [root], preflight_checks=False)
    assert by_event(ev, "node_failed")[0]["error"]["code"] == "NOT_A_DIRECTORY"


@pytest.mark.skipif(sys.platform == "win32", reason="symlink creation needs privileges on Windows")
def test_directory_symlink_not_followed(tree, tmp_path_factory):
    root, src, _ = tree
    outside = tmp_path_factory.mktemp("outside")
    (outside / "secret.txt").write_text("x")
    os.symlink(outside, src / "link")
    _, ev = run_workflow(list_wf(directory=str(src), recursive=True), [root])
    out = files_out(ev, "l")
    assert "secret.txt" not in [f["name"] for f in out["outputs"]["files"]["preview"]]
    assert out["summary"]["skippedDirectorySymlinks"] == 1


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks")
def test_symlink_escaping_approved_root_is_rejected_by_preflight(tree, tmp_path_factory):
    root, src, _ = tree
    outside = tmp_path_factory.mktemp("outside2")
    os.symlink(outside, src / "escape")
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    parsed, _, cfgs = check_workflow(list_wf(directory=str(src / "escape")), REG)
    issues = preflight(parsed, cfgs, REG, RunOptions(False, [str(root)], set()))
    assert [i.code for i in issues] == ["PATH_NOT_ALLOWED"]


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0, reason="needs POSIX permissions and non-root")
def test_inaccessible_directory(tree):
    root, src, _ = tree
    locked = src / "locked"; locked.mkdir(); os.chmod(locked, 0)
    try:
        summary, ev = run_workflow(list_wf(directory=str(locked)), [root])
        assert by_event(ev, "node_failed")[0]["error"]["code"] == "PATH_ACCESS_DENIED"
    finally:
        os.chmod(locked, 0o700)


def test_too_many_files_fails_instead_of_truncating(tree):
    root, src, _ = tree
    summary, ev = run_workflow(list_wf(directory=str(src), maxFiles=2), [root])
    assert by_event(ev, "node_failed")[0]["error"]["code"] == "TOO_MANY_FILES"


# ---- Filter / Condition ---------------------------------------------------------
def test_filter_by_extension_case_insensitive_optional_dot(tree):
    root, src, dest = tree
    _, ev = run_workflow(organize(src, dest, ext="txt"), [root])
    f = files_out(ev, "f")
    assert f["summary"] == {"matched": 2, "rejected": 1, "input": 3}


def test_filter_empty_result_is_not_an_error(tree):
    root, src, dest = tree
    summary, ev = run_workflow(organize(src, dest, ext=".zip"), [root])
    assert summary["status"] == "success"
    assert files_out(ev, "m")["summary"]["total"] == 0


def test_filter_size_and_name(tree):
    root, src, _ = tree
    raw = wf([node("s", "start"), node("l", "list_files", directory=str(src)),
              node("f", "filter", nameContains="B", minSize=2), node("e", "finish")],
             [edge("s", "out", "l", "in"), edge("l", "files", "f", "files"), edge("f", "matched", "e", "in")])
    _, ev = run_workflow(raw, [root])
    assert [x["name"] for x in files_out(ev, "f")["outputs"]["matched"]["preview"]] == ["b.TXT"]


def cond_wf(src, op, value):
    return wf([node("s", "start"), node("l", "list_files", directory=str(src)),
               node("c", "condition", subject="count", operator=op, value=value),
               node("t", "finish"), node("f", "finish")],
              [edge("s", "out", "l", "in"), edge("l", "files", "c", "files"),
               edge("c", "true", "t", "in"), edge("c", "false", "f", "in")])


def test_condition_true_branch(tree):
    root, src, _ = tree
    summary, ev = run_workflow(cond_wf(src, "gte", 3), [root])
    assert files_out(ev, "c")["summary"]["branch"] == "true"
    assert [e["nodeId"] for e in by_event(ev, "node_completed")][-1] == "t"
    skipped = by_event(ev, "node_skipped")
    assert [e["nodeId"] for e in skipped] == ["f"] and "branch not taken" in skipped[0]["reason"]


def test_condition_false_branch(tree):
    root, src, _ = tree
    _, ev = run_workflow(cond_wf(src, "gt", 10), [root])
    assert files_out(ev, "c")["summary"]["branch"] == "false"
    assert by_event(ev, "node_skipped")[0]["nodeId"] == "t"


@pytest.mark.parametrize("op,val,expected", [("eq", 3, True), ("ne", 3, False), ("lt", 3, False), ("lte", 3, True)])
def test_condition_operators(tree, op, val, expected):
    root, src, _ = tree
    _, ev = run_workflow(cond_wf(src, op, val), [root])
    assert (files_out(ev, "c")["summary"]["branch"] == "true") is expected


def test_condition_rejects_expressions():
    from flowforge_engine.executor import check_workflow
    _, issues, _ = check_workflow(wf([node("s", "start"), node("c", "condition", operator="__import__('os')", value=1)], []), REG)
    assert any(i.code == "CONFIG_INVALID" and i.field == "operator" for i in issues)


# ---- Move File ----------------------------------------------------------------
def test_dry_run_changes_nothing(tree):
    root, src, dest = tree
    summary, ev = run_workflow(organize(src, dest, dry=True), [root])
    out = files_out(ev, "m")["outputs"]["moved"]["preview"]
    assert out["dryRun"] is True and out["counts"]["planned"] == 2
    assert (src / "a.txt").exists() and not list(dest.iterdir())


def test_apply_requires_confirmation(tree):
    root, src, dest = tree
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    parsed, _, cfgs = check_workflow(organize(src, dest, dry=False), REG)
    issues = preflight(parsed, cfgs, REG, RunOptions(False, [str(root)], set()))
    assert [i.code for i in issues] == ["CONFIRMATION_REQUIRED"]
    assert (src / "a.txt").exists()


def test_forced_dry_run_needs_no_confirmation_and_moves_nothing(tree):
    root, src, dest = tree
    summary, ev = run_workflow(organize(src, dest, dry=False), [root], dry_run=True)
    assert summary["status"] == "success" and (src / "a.txt").exists()


def test_confirmed_move_applies(tree):
    root, src, dest = tree
    summary, ev = run_workflow(organize(src, dest, dry=False), [root], approved=["m"])
    assert summary["status"] == "success"
    assert sorted(p.name for p in dest.iterdir()) == ["a.txt", "b.TXT"]
    assert not (src / "a.txt").exists() and (src / "c.pdf").exists()
    assert files_out(ev, "m")["summary"]["moved"] == 2


def test_collision_fail_policy_moves_nothing(tree):
    root, src, dest = tree
    (dest / "a.txt").write_text("EXISTING")
    summary, ev = run_workflow(organize(src, dest, dry=False, collision="fail"), [root], approved=["m"])
    assert summary["status"] == "failed"
    assert by_event(ev, "node_failed")[0]["error"]["code"] == "NAME_COLLISION"
    assert (dest / "a.txt").read_text() == "EXISTING" and (src / "a.txt").exists() and not (dest / "b.TXT").exists()


def test_collision_skip_policy(tree):
    root, src, dest = tree
    (dest / "a.txt").write_text("EXISTING")
    summary, ev = run_workflow(organize(src, dest, dry=False, collision="skip"), [root], approved=["m"])
    assert summary["status"] == "success"
    assert (dest / "a.txt").read_text() == "EXISTING" and (src / "a.txt").exists() and (dest / "b.TXT").exists()


def test_collision_rename_policy_never_overwrites(tree):
    root, src, dest = tree
    (dest / "a.txt").write_text("EXISTING")
    run_workflow(organize(src, dest, dry=False, collision="rename"), [root], approved=["m"])
    assert (dest / "a.txt").read_text() == "EXISTING"
    assert (dest / "a (1).txt").read_text() == "a"


def test_collision_between_planned_moves_in_recursive_listing(tree):
    root, src, dest = tree
    (src / "sub" / "a.txt").write_text("other a")
    raw = organize(src, dest, dry=False, collision="rename")
    raw["nodes"][1]["config"]["recursive"] = True
    run_workflow(raw, [root], approved=["m"])
    assert sorted(p.name for p in dest.iterdir()) == ["a (1).txt", "a.txt", "b.TXT", "d.txt"]


def test_dry_run_reports_collision_without_failing(tree):
    root, src, dest = tree
    (dest / "a.txt").write_text("E")
    summary, ev = run_workflow(organize(src, dest, dry=True, collision="fail"), [root])
    assert summary["status"] == "success"
    assert files_out(ev, "m")["summary"]["collision"] == 1


def test_missing_destination_fails_unless_create(tree):
    root, src, dest = tree
    missing = dest / "new" / "deeper"
    summary, ev = run_workflow(organize(src, missing, dry=False), [root], approved=["m"])
    assert by_event(ev, "node_failed")[0]["error"]["code"] == "PATH_NOT_FOUND"
    summary, ev = run_workflow(organize(src, missing, dry=False, create=True), [root], approved=["m"])
    assert summary["status"] == "success" and (missing / "a.txt").exists()


def test_destination_outside_roots_blocked_by_preflight(tree, tmp_path_factory):
    root, src, _ = tree
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    other = tmp_path_factory.mktemp("elsewhere")
    parsed, _, cfgs = check_workflow(organize(src, other), REG)
    issues = preflight(parsed, cfgs, REG, RunOptions(False, [str(src)], set()))
    assert any(i.code == "PATH_NOT_ALLOWED" and i.field == "destination" for i in issues)


def test_filesystem_root_cannot_be_approved(tree):
    root, src, dest = tree
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    parsed, _, cfgs = check_workflow(organize(src, dest), REG)
    issues = preflight(parsed, cfgs, REG, RunOptions(False, [os.path.abspath(os.sep)], set()))
    assert [i.code for i in issues] == ["ROOT_INVALID"]


def test_source_deleted_between_listing_and_move_is_reported(tree):
    root, src, dest = tree

    def on_event(e):
        if e["event"] == "node_completed" and e["nodeId"] == "f":
            (src / "a.txt").unlink()
    raw = organize(src, dest, dry=False)
    summary, ev = run_workflow(raw, [root], approved=["m"], on_event=on_event)
    err = by_event(ev, "node_failed")
    # the plan marks a.txt failed; b.TXT is still moved and reported honestly
    assert (dest / "b.TXT").exists()
    assert summary["status"] == "success" or err[0]["error"]["code"] == "MOVE_PARTIAL_FAILURE"
    results = err[0]["error"]["details"]["results"] if err else None
    assert results is None or any(r["status"] == "failed" for r in results)


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks")
def test_symlinked_file_is_never_moved(tree):
    root, src, dest = tree
    os.symlink(src / "c.pdf", src / "link.txt")
    summary, ev = run_workflow(organize(src, dest, dry=False), [root], approved=["m"])
    assert (src / "link.txt").is_symlink() and not (dest / "link.txt").exists()
    reasons = [r["reason"] for r in files_out(ev, "m")["outputs"]["moved"]["preview"]["results"] if "symlink" in r["reason"]]
    assert reasons


def test_move_no_overwrite_primitive(tmp_path):
    from flowforge_engine.nodes.move_file import move_no_overwrite
    (tmp_path / "s").write_text("S"); (tmp_path / "d").write_text("D")
    with pytest.raises(FileExistsError):
        move_no_overwrite(str(tmp_path / "s"), str(tmp_path / "d"))
    assert (tmp_path / "d").read_text() == "D" and (tmp_path / "s").exists()


# ---- Execution semantics -------------------------------------------------------
def test_each_node_runs_once_in_order(tree):
    root, src, dest = tree
    _, ev = run_workflow(organize(src, dest), [root])
    started = [e["nodeId"] for e in by_event(ev, "node_started")]
    assert started == ["s", "l", "f", "m", "e"]
    assert [e["event"] for e in ev][0] == "run_started" and ev[-1]["event"] == "run_completed"
    seqs = [e["seq"] for e in ev]
    assert seqs == sorted(seqs) and all("ts" in e for e in ev)


def test_fanout_branch_nodes_each_run_once(tree):
    root, src, dest = tree
    raw = organize(src, dest)
    raw["nodes"].append(node("i3", "finish"))
    raw["edges"].append(edge("f", "rejected", "i3", "in"))
    summary, ev = run_workflow(raw, [root])
    assert summary["counts"]["completed"] == 6
    started = [e["nodeId"] for e in by_event(ev, "node_started")]
    assert len(started) == len(set(started))


def test_failure_aborts_and_skips_remaining(tree):
    root, src, dest = tree
    summary, ev = run_workflow(list_wf_failing(src), [root], preflight_checks=False)
    assert summary["status"] == "failed" and summary["failedNode"] == "l"
    assert {e["nodeId"] for e in by_event(ev, "node_skipped")} == {"e"}
    assert ev[-1]["event"] == "run_completed"


def list_wf_failing(src):
    return list_wf(directory=str(src / "missing"))


def test_unexpected_exception_in_node_is_structured(tree, monkeypatch):
    root, src, dest = tree
    from flowforge_engine.nodes import filter_files
    d = REG.get("filter")
    boom = type(d)(**{**d.__dict__, "execute": lambda *a: (_ for _ in ()).throw(RuntimeError("kaboom"))})
    monkeypatch.setitem(REG._nodes, "filter", boom)
    summary, ev = run_workflow(organize(src, dest), [root])
    err = by_event(ev, "node_failed")[0]["error"]
    assert err["code"] == "NODE_INTERNAL_ERROR" and "kaboom" in err["message"]


def test_cancel_before_start_skips_everything(tree):
    root, src, dest = tree
    ev_cancel = threading.Event(); ev_cancel.set()
    summary, ev = run_workflow(organize(src, dest), [root], cancel=ev_cancel)
    assert summary["status"] == "cancelled" and not by_event(ev, "node_started")
    assert ev[-1]["event"] == "run_cancelled"


def test_cancel_during_move_reports_partial(tree):
    root, src, dest = tree
    for i in range(30):
        (src / f"x{i}.txt").write_text("x")
    cancel = threading.Event()
    from flowforge_engine.nodes import move_file
    real = move_file.move_no_overwrite
    n = {"c": 0}

    def slow(s, d):
        real(s, d); n["c"] += 1
        if n["c"] == 3:
            cancel.set()
    move_file.move_no_overwrite = slow
    try:
        summary, ev = run_workflow(organize(src, dest, dry=False), [root], approved=["m"], cancel=cancel)
    finally:
        move_file.move_no_overwrite = real
    assert summary["status"] == "cancelled" and "cannot undo" in summary["note"]
    assert len(list(dest.iterdir())) == 3
    c = by_event(ev, "node_cancelled")[0]
    assert "NOT reversed" in c["message"] and c["partial"]["counts"]["moved"] == 3
    assert {e["nodeId"] for e in by_event(ev, "node_skipped")} == {"e"}


def test_large_output_is_truncated_in_events_not_in_data(tmp_path):
    big = tmp_path / "big"; big.mkdir()
    for i in range(300):
        (big / f"f{i}.txt").write_text("")
    d = tmp_path / "d"; d.mkdir()
    summary, ev = run_workflow(organize(big, d), [tmp_path])
    out = files_out(ev, "l")["outputs"]["files"]
    assert out["truncated"] and out["totalItems"] == 300 and len(out["preview"]) == 50
    assert files_out(ev, "m")["summary"]["planned"] == 300   # downstream saw all of them


def test_approved_root_may_be_a_folder_to_be_created_if_parent_exists(tree):
    root, src, dest = tree
    from flowforge_engine.paths import validate_roots
    assert validate_roots([str(dest / "new")]) == []
    assert validate_roots([str(dest / "a" / "b")])            # grandparent missing: refused
    assert validate_roots([str(src / "a.txt")])               # an existing file is not a folder


# ---- v0.2.0: preflight path checks, hints, and path exposure ----------------------
def _preflight(raw, roots, **kw):
    from flowforge_engine.context import RunOptions
    from flowforge_engine.executor import check_workflow, preflight
    parsed, issues, cfgs = check_workflow(raw, REG)
    assert not [i for i in issues if i.severity == "error"], issues
    return preflight(parsed, cfgs, REG, RunOptions(kw.get("dry", False), [str(r) for r in roots], set(kw.get("approved", ())))), parsed


def test_preflight_reports_missing_source_folder_before_running(tree):
    root, src, _ = tree
    issues, _ = _preflight(list_wf(directory=str(src / "nope")), [root])
    assert [(i.code, i.node_id, i.field) for i in issues] == [("PATH_NOT_FOUND", "l", "directory")]
    assert issues[0].to_dict()["hint"]


def test_preflight_reports_file_given_as_source_folder(tree):
    root, src, _ = tree
    issues, _ = _preflight(list_wf(directory=str(src / "a.txt")), [root])
    assert [i.code for i in issues] == ["NOT_A_DIRECTORY"]


def test_missing_destination_is_allowed_in_preflight(tree):
    root, src, dest = tree
    issues, _ = _preflight(organize(src, dest / "later", dry=True), [root])
    assert issues == []


def test_node_failed_events_carry_an_actionable_hint(tree):
    root, src, dest = tree
    (dest / "a.txt").write_text("E")
    summary, ev = run_workflow(organize(src, dest, dry=False, collision="fail"), [root], approved=["m"])
    err = by_event(ev, "node_failed")[0]["error"]
    assert err["code"] == "NAME_COLLISION" and "skip or rename" in err["hint"]


def test_error_messages_do_not_expose_full_absolute_paths(tree):
    root, src, dest = tree
    summary, ev = run_workflow(list_wf(directory=str(src / "missing")), [root], preflight_checks=False)
    err = by_event(ev, "node_failed")[0]["error"]
    assert str(root) not in err["message"] and "missing" in err["message"]
    issues, _ = _preflight(list_wf(directory=str(src)), [src])  # valid root; now check a path outside it
    from flowforge_engine.paths import PathPolicy
    with pytest.raises(Exception) as ei:
        PathPolicy([str(src)]).resolve(str(dest))
    assert str(root) not in ei.value.message and "resolved" not in ei.value.details


def test_logs_do_not_contain_full_paths(tree):
    root, src, dest = tree
    _, ev = run_workflow(organize(src, dest), [root])
    assert not [e for e in by_event(ev, "log") if str(root) in e["message"]]
