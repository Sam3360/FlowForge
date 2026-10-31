from conftest import REG, edge, node, wf, organize
from flowforge_engine.executor import check_workflow
from flowforge_engine.workflow import has_errors


def codes(raw):
    _, issues, _ = check_workflow(raw, REG)
    return {i.code for i in issues if i.severity == "error"}, issues


def test_valid_organize_workflow(tmp_path):
    c, issues = codes(organize(tmp_path, tmp_path))
    assert c == set()


def test_unsupported_schema_version():
    c, _ = codes({"schemaVersion": 99, "nodes": [], "edges": []})
    assert c == {"UNSUPPORTED_SCHEMA_VERSION"}


def test_not_an_object():
    assert codes([1, 2])[0] == {"WORKFLOW_INVALID"}


def test_missing_start():
    assert "START_MISSING" in codes(wf([node("f", "finish")], []))[0]


def test_multiple_start():
    c, _ = codes(wf([node("a", "start"), node("b", "start")], []))
    assert "START_MULTIPLE" in c


def test_unknown_node_type():
    c, _ = codes(wf([node("s", "start"), node("x", "teleport")], []))
    assert "NODE_TYPE_UNKNOWN" in c


def test_duplicate_node_id():
    c, _ = codes(wf([node("s", "start"), node("s", "finish")], []))
    assert "NODE_ID_DUPLICATE" in c


def test_bad_node_id():
    c, _ = codes(wf([node("../evil", "start")], []))
    assert "NODE_ID_INVALID" in c


def test_dangling_edge():
    c, _ = codes(wf([node("s", "start")], [edge("s", "out", "ghost", "in")]))
    assert "EDGE_DANGLING" in c


def test_unknown_port():
    c, _ = codes(wf([node("s", "start"), node("e", "finish")], [edge("s", "nope", "e", "in")]))
    assert "PORT_UNKNOWN" in c


def test_type_mismatch():
    # context -> filter(files) is incompatible
    c, _ = codes(wf([node("s", "start"), node("f", "filter")], [edge("s", "out", "f", "files")]))
    assert "PORT_TYPE_MISMATCH" in c


def test_input_with_two_edges():
    nodes = [node("s", "start"), node("l1", "list_files", directory="/x"), node("l2", "list_files", directory="/x"), node("e", "finish")]
    c, _ = codes(wf(nodes, [edge("s", "out", "l1", "in"), edge("s", "out", "l2", "in"),
                            edge("l1", "files", "e", "in"), edge("l2", "files", "e", "in")]))
    assert "INPUT_MULTIPLE_EDGES" in c


def test_required_input_unconnected():
    c, _ = codes(wf([node("s", "start"), node("f", "filter")], []))
    assert "INPUT_NOT_CONNECTED" in c


def test_cycle_detected():
    nodes = [node("s", "start"), node("a", "filter"), node("b", "filter")]
    c, _ = codes(wf(nodes, [edge("a", "matched", "b", "files"), edge("b", "matched", "a", "files")]))
    assert "GRAPH_CYCLE" in c


def test_config_errors():
    c, issues = codes(wf([node("s", "start"), node("l", "list_files", directory="relative", recursive="yes", bogus=1)], []))
    assert {"CONFIG_UNKNOWN_FIELD", "CONFIG_INVALID"} <= c
    assert any(i.field == "recursive" for i in issues)


def test_required_config_missing():
    c, issues = codes(wf([node("s", "start"), node("l", "list_files")], [edge("s", "out", "l", "in")]))
    assert "CONFIG_REQUIRED" in c


def test_filter_size_range_validated():
    c, _ = codes(wf([node("s", "start"), node("f", "filter", minSize=10, maxSize=1)], []))
    assert "CONFIG_INVALID" in c


def test_disconnected_finish_is_error():
    _, issues = codes(wf([node("s", "start"), node("e", "finish")], []))
    assert any(i.code == "INPUT_NOT_CONNECTED" for i in issues)


def test_editor_metadata_is_ignored(tmp_path):
    raw = organize(tmp_path, tmp_path)
    raw["editor"] = {"viewport": {"x": 1, "y": 2, "zoom": 1}}
    assert codes(raw)[0] == set()


def test_issues_carry_hints_and_warnings_do_not_block(tmp_path):
    raw = organize(tmp_path, tmp_path)
    raw["nodes"] = [n for n in raw["nodes"] if n["id"] != "e"]
    raw["edges"] = [e for e in raw["edges"] if e["target"] != "e"]
    _, issues, _ = check_workflow(raw, REG)
    assert not has_errors(issues)                       # a workflow without Finish is still valid
    warn = {i.code: i for i in issues if i.severity == "warning"}
    assert set(warn) == {"FINISH_MISSING", "NODE_DEAD_END"} and warn["NODE_DEAD_END"].node_id == "m"
    assert all(i.to_dict()["hint"] for i in issues)


def test_condition_with_one_branch_connected_is_not_a_dead_end(tmp_path):
    raw = wf([node("s", "start"), node("l", "list_files", directory=str(tmp_path)), node("c", "condition", value=1), node("e", "finish")],
             [edge("s", "out", "l", "in"), edge("l", "files", "c", "files"), edge("c", "true", "e", "in")])
    _, issues, _ = check_workflow(raw, REG)
    assert issues == []


def test_errors_have_hints_for_every_code_used():
    from flowforge_engine.errors import HINTS
    _, issues = codes(wf([node("a", "start"), node("b", "start"), node("x", "nope"), node("f", "filter")], [edge("a", "out", "ghost", "in")]))
    assert issues and all(i.code in HINTS for i in issues)
