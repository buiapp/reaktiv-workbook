"""Ruff-compatible layout for the code the workbook writer generates.

The writer emits workbook scaffolding (`cell(...)`, `worksheet(...)`, `@workbook_config`,
`@action`, note strings) and copies user code verbatim. Formatting the scaffolding the
way `ruff format` would means running ruff on a workbook and saving it again do not
undo each other. Ruff itself cannot be used: the writer also runs in Pyodide.

Only literal structure is laid out (calls, dicts, lists, strings, names). Anything else,
such as `field(...)` with a user-typed value or a widget `lambda`, is copied verbatim so
the text the user typed never changes.
"""
from __future__ import annotations

import ast
from typing import Sequence

LINE_LENGTH = 88
# Calls whose arguments the writer generates; other calls are user text.
SCAFFOLD_CALLS = frozenset({"cell", "worksheet", "workbook_config", "action", "linked"})


class _Unformattable(Exception):
    """A part spans several lines; leave the statement as written."""


def py_string(value: str) -> str:
    """A string literal quoted the way ruff prefers: double quotes unless that needs more escapes."""
    single = repr(value)
    if single.startswith('"'):
        return single  # contains ' and no ": Python already chose double quotes
    if "'" not in value:
        return single if '"' in value else '"' + single[1:-1] + '"'
    if value.count('"') > value.count("'"):
        return single
    body, index = single[1:-1], 0
    characters: list[str] = []
    while index < len(body):
        if body[index] == "\\" and index + 1 < len(body):
            pair = body[index:index + 2]
            characters.append("'" if pair == "\\'" else pair)
            index += 2
            continue
        characters.append('\\"' if body[index] == '"' else body[index])
        index += 1
    return '"' + "".join(characters) + '"'


def _opaque(source: str, node: ast.AST) -> str:
    text = ast.get_source_segment(source, node)
    if text is None or "\n" in text:
        raise _Unformattable
    return text


def _structured(node: ast.AST) -> bool:
    if isinstance(node, (ast.Dict, ast.List)):
        return True
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SCAFFOLD_CALLS


def _parts(source: str, node: ast.AST) -> tuple[str, str, list[tuple[str, ast.AST]]]:
    if isinstance(node, ast.Call):
        assert isinstance(node.func, ast.Name)
        items: list[tuple[str, ast.AST]] = [("", argument) for argument in node.args]
        for keyword in node.keywords:
            if keyword.arg is None:
                raise _Unformattable
            items.append((keyword.arg + "=", keyword.value))
        return node.func.id + "(", ")", items
    if isinstance(node, ast.Dict):
        entries: list[tuple[str, ast.AST]] = []
        for key, value in zip(node.keys, node.values):
            if key is None:
                raise _Unformattable
            key_text = flat(source, key)
            if key_text is None:
                raise _Unformattable
            entries.append((key_text + ": ", value))
        return "{", "}", entries
    assert isinstance(node, ast.List)
    return "[", "]", [("", item) for item in node.elts]


def _has_comment(text: str) -> bool:
    import io
    import tokenize
    try:
        return any(token.type == tokenize.COMMENT for token in tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError):
        return True


def _lambda_head(source: str, node: ast.Lambda) -> str:
    """`lambda self: ` — the parameters as written."""
    text = ast.get_source_segment(source, node)
    if text is None:
        raise _Unformattable
    start = text.find(":", len("lambda"))
    while start != -1:
        try:
            ast.parse(text[:start] + ": None", mode="eval")
            return text[:start] + ": "
        except SyntaxError:
            start = text.find(":", start + 1)
    raise _Unformattable


def _lambda_body(source: str, node: ast.Lambda) -> str:
    body = ast.get_source_segment(source, node.body)
    whole = ast.get_source_segment(source, node)
    if body is None or whole is None or _has_comment(whole):
        raise _Unformattable  # comments live outside the expression node: keep as written
    if isinstance(node.body, (ast.NamedExpr, ast.Lambda)):
        return "(" + body + ")"  # needs its parentheses
    return body


def _value_call(node: ast.AST) -> ast.expr | None:
    """The user-typed value of `field(value)`; it is copied verbatim, never re-laid out."""
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "field"
            and len(node.args) == 1 and not node.keywords):
        return node.args[0]
    return None


def _expression_lines(source: str, value: ast.expr, column: int) -> list[str]:
    """A parenthesized expression's lines indented as ruff does: the first line at
    ``column``, continuation lines moved so the least indented one is at ``column`` too
    (their relative indentation is kept). Inside brackets that whitespace has no meaning,
    except in multi-line strings, which are copied unchanged."""
    text = ast.get_source_segment(source, value)
    if text is None:
        raise _Unformattable
    first, *rest = text.split("\n")
    if not rest:
        return [" " * column + first]
    if any(isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)) and node.end_lineno != node.lineno
           for node in ast.walk(value)):
        return [" " * column + first, *rest]
    margin = min((len(line) - len(line.lstrip()) for line in rest if line.strip()), default=0)
    return [" " * column + first, *((" " * column + line[margin:]) if line.strip() else "" for line in rest)]


def _value_lines(source: str, value: ast.expr, column: int, shift: int) -> list[str]:
    """A multi-line value starting at ``column``; its other lines stay exactly as stored,
    because the stored text is what the user typed (ruff's layout of it after a ruff run)."""
    text = ast.get_source_segment(source, value)
    if text is None:
        raise _Unformattable
    first, *rest = text.split("\n")
    # ``shift`` is the indentation the caller removes again from every line.
    return [" " * column + first, *(" " * shift + line for line in rest)]


def flat(source: str, node: ast.AST) -> str | None:
    """The expression on one line, or None when it has to be split (a multi-line value)."""
    value = _value_call(node)
    if value is not None:
        text = ast.get_source_segment(source, value)
        if text is None:
            raise _Unformattable
        return None if "\n" in text else "field(" + text + ")"
    if isinstance(node, ast.Lambda):
        # The writer wraps widget expressions in parentheses; ruff drops redundant ones.
        body = _lambda_body(source, node)
        return None if "\n" in body else _lambda_head(source, node) + body
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and not isinstance(node.value, bytes):
        return py_string(node.value)
    if isinstance(node, ast.Constant) and (node.value is None or isinstance(node.value, (bool, int, float))):
        return repr(node.value)
    if isinstance(node, ast.Name):
        return node.id
    if _structured(node):
        opening, closing, items = _parts(source, node)
        texts = [flat(source, value) for _, value in items]
        if any(text is None for text in texts):
            return None
        return opening + ", ".join(head + str(text) for (head, _), text in zip(items, texts)) + closing
    return _opaque(source, node)


def layout(source: str, node: ast.AST, column: int, head: str = "", tail: str = "", shift: int = 0) -> list[str]:
    """Lines (with indentation) for ``head + node + tail`` starting at ``column``, split like ruff.
    ``shift`` is indentation counted in ``column`` that the caller strips from each line."""
    indent = " " * column
    text = flat(source, node)
    if text is not None and column + len(head) + len(text) + len(tail) <= LINE_LENGTH:
        return [indent + head + text + tail]
    value = _value_call(node)
    if value is not None:  # too long or several lines: the value goes on its own lines
        return [indent + head + "field(", *_value_lines(source, value, column + 4, shift), indent + ")" + tail]
    if isinstance(node, ast.Lambda) and not isinstance(node.body, (ast.NamedExpr, ast.Lambda)):
        # Too long: ruff parenthesizes the body on its own lines (kept as typed).
        return [indent + head + _lambda_head(source, node) + "(",
                *_expression_lines(source, node.body, column + 4), indent + ")" + tail]
    if not _structured(node):
        if text is None:
            raise _Unformattable
        return [indent + head + text + tail]
    opening, closing, items = _parts(source, node)
    if not items:
        return [indent + head + str(text) + tail]
    texts = [flat(source, value) for _, value in items]
    body = None if any(item is None for item in texts) else ", ".join(
        item_head + str(item) for (item_head, _), item in zip(items, texts))
    # Call arguments stay together on one line when they fit there, unless one of them
    # is a dict or list literal; a split dict or list always takes one entry per line.
    hug = isinstance(node, ast.Call) and not any(
        not item_head and isinstance(value, (ast.Dict, ast.List)) and (getattr(value, "keys", None) or getattr(value, "elts", None))
        for item_head, value in items)
    if hug and body is not None and column + 4 + len(body) <= LINE_LENGTH:
        return [indent + head + opening, " " * (column + 4) + body, indent + closing + tail]
    # Splitting at commas adds a trailing comma; a single element is split inside instead.
    separator = "," if len(items) > 1 else ""
    lines = [indent + head + opening]
    for item_head, value in items:
        lines.extend(layout(source, value, column + 4, item_head, separator, shift))
    return [*lines, indent + closing + tail]


def _replace(source: str, edits: Sequence[tuple[int, int, str]]) -> str:
    """Replace whole-line spans ``(first_line, last_line, text)`` (1-based, inclusive)."""
    lines = source.split("\n")
    for first, last, text in sorted(edits, reverse=True):
        lines[first - 1:last] = text.split("\n")
    return "\n".join(lines)


def format_members(source: str, indent: int = 4) -> str:
    """Lay out the generated parts of class members. ``source`` starts at column 0 and
    will be indented by ``indent``, which counts towards the line length."""
    module = ast.parse(source)
    edits: list[tuple[int, int, str]] = []
    lines = source.split("\n")
    for node in module.body:
        try:
            if (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                    and _structured(node.value) and node.end_lineno is not None
                    and lines[node.lineno - 1][:node.col_offset].strip() == ""):
                edits.append((node.lineno, node.end_lineno, _dedent(
                    layout(source, node.value, node.col_offset + indent, node.targets[0].id + " = ", shift=indent), indent)))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                for decorator in node.decorator_list:
                    if _structured(decorator) and decorator.end_lineno is not None:
                        column = decorator.col_offset - 1
                        edits.append((decorator.lineno, decorator.end_lineno,
                                      _dedent(layout(source, decorator, column + indent, "@", shift=indent), indent)))
                edits.extend(_note_string(source, node))
        except _Unformattable:
            continue
    return _replace(source, edits)


def _dedent(lines: list[str], indent: int) -> str:
    return "\n".join(line[indent:] for line in lines)


def _note_string(source: str, node: ast.stmt) -> list[tuple[int, int, str]]:
    """A one-line note text (`return '...'`) in ruff's preferred quotes."""
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not any(
            isinstance(item, ast.Name) and item.id == "markdown" for item in node.decorator_list):
        return []
    final = node.body[-1] if node.body else None
    if not isinstance(final, ast.Return) or not isinstance(final.value, ast.Constant) or not isinstance(final.value.value, str):
        return []
    text = ast.get_source_segment(source, final.value) or ""
    if "\n" in text or text.startswith(('"""', "'''")) or text[:1] not in "'\"":
        return []
    line = source.split("\n")[final.lineno - 1].encode()  # AST offsets count UTF-8 bytes
    prefix = line[:final.value.col_offset].decode()
    suffix = line[final.value.end_col_offset or 0:].decode()
    return [(final.lineno, final.lineno, prefix + py_string(final.value.value) + suffix)]
