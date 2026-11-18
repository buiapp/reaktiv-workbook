"""Language intelligence must work on incomplete buffers without running cells."""

import pytest

from reaktiv_workbook.editor import EditorService, language_server_command, virtual_source
from reaktiv_workbook.model import CellDefinition, SheetDocument, SheetTab
from reaktiv_workbook.runtime import RuntimeServer


def document():
    return SheetDocument(
        cells=(
            CellDefinition("A1", "input", '"hello"', name="value"),
            CellDefinition(
                "A2",
                "formula",
                "def greet(name: str, count: int = 1) -> str:\n    return name * count",
                name="greet",
            ),
            CellDefinition(
                "A3",
                "formula",
                "class Customer:\n    name: str\n    def greet(self, count: int = 1) -> str:\n        return self.name * count",
                name="Customer",
            ),
            CellDefinition(
                "A4",
                "formula",
                'raise RuntimeError("must never execute")',
                name="danger",
            ),
            CellDefinition("Other!A1", "input", "123", name="value"),
        ),
        sheets=(SheetTab(name="Other"),),
    )


def test_virtual_editor_keeps_dirty_unicode_source_and_sheet_local_aliases():
    text, offset = virtual_source(document(), "", 'emoji = "😀"\nvalue.')
    assert text.splitlines()[offset:] == ['    emoji = "😀"', "    value."]
    probe = text.split("def __reaktiv_editor():")[1]
    assert "value = _reaktiv_editor_book.Sheet1.value()" in probe
    other, _ = virtual_source(document(), "Other", "value.")
    assert (
        "value = _reaktiv_editor_book.Other.value()"
        in other.split("def __reaktiv_editor():")[1]
    )


@pytest.mark.skipif(language_server_command() is None, reason="requires Pyright")
def test_persistent_server_completes_values_functions_classes_and_cross_sheet_types():
    editor = EditorService()
    doc = document()

    def query(source, action="completion", sheet="", **kwargs):
        return editor.query(
            doc,
            sheet,
            source,
            {
                "line": source.count("\n"),
                "character": len(source.split("\n")[-1].encode("utf-16-le")) // 2,
            },
            action,
            **kwargs,
        )

    try:
        first = query("value.")
        assert first["available"], first
        upper = next(item for item in first["completions"] if item["label"] == "upper")
        resolved = query("value.", "completionResolve", completion_key=upper["key"])
        assert "str" in resolved["result"]["documentation"]["value"]
        names = query('')
        assert all(not item['label'].startswith(('_reaktiv_editor', '_ReaktivEditorSheet')) for item in names['completions'])
        handles = query('cells.value.')
        assert {'get', 'set', 'update'} <= {item['label'] for item in handles['completions']}
        typed_set = query('cells.value.set(', 'signatureHelp')
        assert 'str' in typed_set['result']['signatures'][0]['label']
        process = editor._process
        signature = query("greet(", "signatureHelp")
        assert "name: str" in signature["result"]["signatures"][0]["label"]
        assert "count: int" in signature["result"]["signatures"][0]["label"]
        members = query("person = Customer()\nperson.")
        assert {"name", "greet"} <= {item["label"] for item in members["completions"]}
        qualified = query("Sheet1.value.", sheet="Other")
        assert "upper" in {item["label"] for item in qualified["completions"]}
        own = query("value.", sheet="Other")
        assert "bit_length" in {item["label"] for item in own["completions"]}
        assert "upper" not in {item["label"] for item in own["completions"]}
        unicode = query('emoji = "😀"; value.')
        assert "upper" in {item["label"] for item in unicode["completions"]}
        assert editor._process is process
    finally:
        editor.close()
    assert process.poll() is not None


def test_missing_server_is_optional_and_endpoint_does_not_take_workbook_lock(
    monkeypatch,
):
    monkeypatch.setattr("reaktiv_workbook.editor.language_server_command", lambda: None)
    server = RuntimeServer()
    server._lock.acquire()
    try:
        reply = server.dispatch(
            "/v1/editor",
            {
                "document": document().to_dict(),
                "sheet": "",
                "source": "value.",
                "position": {"line": 0, "character": 6},
                "action": "completion",
            },
        )
        assert reply["available"] is False
        assert server.workbook._last_values == {}
    finally:
        server._lock.release()
        server.close()


def test_action_editor_preserves_incomplete_method_in_typed_model_context():
    source = 'async def explore(self, count: int = 1):\n    # 😀 keep offsets\n    self.Sheet1.value.'
    text, offset = virtual_source(document(), "", source)
    assert "class _ReaktivEditorAction(" in text
    assert text.splitlines()[offset:] == ["    " + line for line in source.split("\n")]
    assert "def __reaktiv_editor():" not in text


@pytest.mark.skipif(language_server_command() is None, reason="requires Pyright")
def test_action_editor_completes_model_handles_and_typed_reads():
    editor = EditorService()
    try:
        def complete(source):
            response = editor.query(document(), "", source, {
                "line": source.count("\n"),
                "character": len(source.split("\n")[-1]),
            }, "completion")
            assert response["available"]
            return {item["label"] for item in response["completions"]}
        assert "Sheet1" in complete('def explore(self):\n    self.')
        assert "Other" in complete('def explore(self):\n    self.cells.')
        assert "value" in complete('def explore(self):\n    self.cells.Other.')
        assert "set" in complete('def explore(self):\n    self.cells.Other.value.')
        assert "set" in complete('def explore(self):\n    self.Sheet1.value.')
        assert "upper" in complete('def explore(self):\n    self.Sheet1.value().')
        # Switching back must restore ordinary cell scope on the same service.
        complete('value.')
        assert 'def __reaktiv_editor():' in editor._prefix
        assert 'class _ReaktivEditorAction(' not in editor._prefix
        assert "set" in complete('def explore(self):\n    self.Sheet1.value.')
    finally:
        editor.close()


def test_busy_editor_returns_immediately_instead_of_queuing_http_threads():
    from concurrent.futures import ThreadPoolExecutor
    editor = EditorService()
    editor._lock.acquire()
    try:
        pool = ThreadPoolExecutor(max_workers=1)
        future = pool.submit(editor.query, document(), "", "value", {"line": 0, "character": 1}, "hover")
        assert future.result(timeout=0.5) == {"available": True, "result": None}
    finally:
        editor._lock.release()
        pool.shutdown()
        editor.close()


def test_action_virtual_source_exposes_typed_sheet_qualified_cell_handles():
    text, offset = virtual_source(document(), '', 'def explore(self):\n    self.cells.Other.')
    assert 'def cells(self):\n        return _ReaktivEditorCells()' in text
    assert 'def Other(self):' in text
    assert text.splitlines()[offset:] == ['    def explore(self):', '        self.cells.Other.']
