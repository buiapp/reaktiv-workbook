"""Structured Python workbook format; static, source-preserving adapters to the document model.

The legacy cell codec remains responsible for every cell kind. This module owns only
worksheet boundaries, member scopes, and workbook composition; it never executes code.
"""
from __future__ import annotations

import ast
import json
from dataclasses import replace
import re
import textwrap
from typing import TYPE_CHECKING, Any, Iterable, Mapping, Sequence

from .actions import ActionDefinition, action_owner_attributes, rewrite_members
from .narrowing import as_mapping
from .sheets import DEFAULT_SHEET_NAME, qualify, split_cell_id, valid_sheet_name
from .source_layout import LINE_LENGTH, format_members, layout, py_string

if TYPE_CHECKING:
    from .model import CellDefinition, SheetDocument

PYTHON_FORMAT_VERSION = 2
# The class decorator of a format-2 workbook: `workbook_config`; files written before
# the rename use `workbook` (imported from `reaktiv_workbook.composition`).
WORKBOOK_DECORATORS = frozenset({'workbook_config', 'workbook'})


def workbook_marker(node: ast.stmt) -> ast.Call | None:
    """The format-2 decorator call on a class, if ``node`` is the workbook class."""
    if not isinstance(node, ast.ClassDef):
        return None
    return next((marker for marker in node.decorator_list if isinstance(marker, ast.Call)
                 and isinstance(marker.func, ast.Name) and marker.func.id in WORKBOOK_DECORATORS), None)


def is_structured(module: ast.Module) -> bool:
    """Whether parsed source is Python workbook format 2 (else the legacy `@sheet` class)."""
    return any(workbook_marker(node) is not None for node in module.body)


def attribute_path(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = attribute_path(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


def edit_nodes(source: str, edits: Sequence[tuple[ast.AST, str]]) -> str:
    """Apply disjoint AST spans to the original text, preserving comments/formatting."""
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    ranges: list[tuple[int, int, str]] = []
    for node, replacement in edits:
        first, last = getattr(node, "lineno", 0), getattr(node, "end_lineno", 0)
        if not first or not last:
            continue
        start = offsets[first - 1] + len(lines[first - 1].encode()[:getattr(node, 'col_offset', 0)].decode())
        end = offsets[last - 1] + len(lines[last - 1].encode()[:getattr(node, 'end_col_offset', 0)].decode())
        ranges.append((start, end, replacement))
    accepted: list[tuple[int, int, str]] = []
    for item in sorted(ranges, key=lambda item: (item[0], -item[1])):
        if not accepted or item[0] >= accepted[-1][1]:
            accepted.append(item)
    for start, end, replacement in reversed(accepted):
        source = source[:start] + replacement + source[end:]
    return source


def rewrite_attributes(source: str, names: Mapping[str, str], *, markdown: bool = False) -> str:
    tree = ast.parse(source)
    edits: list[tuple[ast.AST, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and (key := attribute_path(node)) is not None and key in names:
            edits.append((node, names[key]))
        elif markdown and isinstance(node, ast.Constant) and isinstance(node.value, str) and '{{' in node.value:
            # Rewrite the references inside the string's own text, so a triple-quoted note
            # keeps its quotes and line breaks.
            written = ast.get_source_segment(source, node) or repr(node.value)
            value = re.sub(r'\{\{(.*?)\}\}', lambda match: '{{' + match[1][:len(match[1]) - len(match[1].lstrip())] + rewrite_attributes(match[1].strip(), names) + match[1][len(match[1].rstrip()):] + '}}', written, flags=re.DOTALL)
            if value != written:
                edits.append((node, value))
    return edit_nodes(source, edits)


def cell_call(node: ast.stmt) -> ast.Call | None:
    candidates: Sequence[ast.expr] = node.decorator_list if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else [node.value] if isinstance(node, ast.Assign) else []
    return next((item for item in candidates if isinstance(item, ast.Call) and isinstance(item.func, ast.Name) and item.func.id == 'cell'), None)


def member_name(node: ast.stmt) -> str | None:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None


def member_source(source: str, node: ast.stmt) -> str:
    lines = source.splitlines()
    first = min([node.lineno, *(item.lineno for item in getattr(node, 'decorator_list', []))]) - 1
    # Include comments immediately above/below a declaration as well as its body.
    while first > 0 and lines[first - 1].lstrip().startswith('#') and len(lines[first - 1]) - len(lines[first - 1].lstrip()) >= node.col_offset:
        first -= 1
    end = node.end_lineno or node.lineno
    while end < len(lines) and (not lines[end].strip() or lines[end].strip().startswith('#') and len(lines[end]) - len(lines[end].lstrip()) > node.col_offset):
        end += 1
    return textwrap.dedent('\n'.join(lines[first:end]))


def rename_declarations(source: str, names: Mapping[str, str]) -> str:
    """Rename declarations and descriptor helper links, never ordinary local names."""
    edits: list[tuple[ast.AST, str]] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.keyword) and node.arg == 'computation' and isinstance(node.value, ast.Name) and node.value.id in names:
            edits.append((node.value, names[node.value.id]))
    source = edit_nodes(source, edits)
    for old, new in names.items():
        source = re.sub(rf'(?m)^(async\s+def\s+|def\s+|@){re.escape(old)}(?=\s*\(|\.loader)', lambda match: match[1] + new, source)
        source = re.sub(rf'(?m)^{re.escape(old)}(?=\s*=)', new, source)
    return source


def local_member_names(cells: Iterable[CellDefinition]) -> dict[str, str]:
    from .model import cell_member_names
    result: dict[str, str] = {}
    groups: dict[str, list[CellDefinition]] = {}
    for cell in cells:
        groups.setdefault(split_cell_id(cell.id)[0], []).append(cell)
    for group in groups.values():
        local = [replace(cell, id=split_cell_id(cell.id)[1]) for cell in group]
        names = cell_member_names(local, {'workbook', 'dispose', 'start_members'})
        result.update({cell.id: names[split_cell_id(cell.id)[1]] for cell in group})
    return result


def workbook_member_names(cells: Iterable[CellDefinition], first_sheet: str = DEFAULT_SHEET_NAME) -> dict[str, str]:
    return {cell_id: f'{split_cell_id(cell_id)[0] or first_sheet}.{member}' for cell_id, member in local_member_names(cells).items()}


def rewrite_action_attributes(source: str, references: Mapping[str, str], *, decorated: bool = False) -> str:
    """Nested methods with another self retain their own object's attributes."""
    return edit_nodes(source, [(node, references[path]) for node in action_owner_attributes(source, decorated=decorated)
                               if (path := attribute_path(node)) is not None and path in references])


def canonical_actions(document: SheetDocument) -> SheetDocument:
    """Upgrade legacy member spellings while retaining explicit reference targets."""
    names = workbook_member_names(document.cells, document.sheet_name)
    local = local_member_names(document.cells)
    actions: list[ActionDefinition] = []
    namespace_refs: dict[str, str] = {}
    for cell in document.cells:
        prefix, coordinate = split_cell_id(cell.id)
        sheet = prefix or document.sheet_name
        for alias in [coordinate, local[cell.id], *([cell.name] if cell.name else [])]:
            namespace_refs[f'self.cells.{sheet}.{alias}'] = cell.id
            if sheet == document.sheet_name:
                namespace_refs[f'self.cells.{alias}'] = cell.id
    from .model import cell_member_names
    flat = {member: cell_id for cell_id, member in cell_member_names(document.cells).items()}
    action_names = {action.name for action in document.actions}
    kinds = {cell.id:cell.kind for cell in document.cells}
    for action in document.actions:
        references = dict(action.references)
        for node in action_owner_attributes(action.source):
            key = attribute_path(node)
            member = key.removeprefix('self.') if key and key.startswith('self.') else ''
            if member in flat and member not in action_names and member not in document.sheet_names:
                references.setdefault(member, flat[member])
        source = rewrite_members(replace(action, references=references), names)
        tree = ast.parse(source)
        owner_positions = {(node.lineno, node.col_offset) for node in action_owner_attributes(source)}
        reads: list[tuple[ast.AST, str]] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or node.args or node.keywords:
                continue
            key = attribute_path(node.func)
            if (getattr(node.func, "lineno", 0), getattr(node.func, "col_offset", 0)) not in owner_positions or key is None:
                continue
            target = namespace_refs.get(key) or namespace_refs.get(key.removesuffix('.get'))
            if target and (kinds[target] == 'resource' or key.endswith('.get')):
                reads.append((node, 'self.' + names[target] + ('.value()' if kinds[target] == 'resource' else '()')))
        source = edit_nodes(source, reads)
        rewrites = {old: 'self.' + names[target] for old, target in namespace_refs.items()}
        # LinkedSignal has no native reset method. Retain this legacy CellRef
        # operation so older workbook actions remain executable outside the app.
        for node in action_owner_attributes(source):
            key = attribute_path(node)
            if key and key.endswith('.reset') and key.removesuffix('.reset') in namespace_refs:
                rewrites[key] = key
        source = rewrite_action_attributes(source, rewrites)
        paths = {'self.' + member: cell_id for cell_id, member in names.items()}
        references = {names[target]: target for target in references.values() if target in names}
        for node in action_owner_attributes(source):
            key = attribute_path(node)
            if key is not None and key in paths:
                references[names[paths[key]]] = paths[key]
        actions.append(replace(action, source=source, references=references))
    return replace(document, actions=tuple(actions))


def dump_document(document: SheetDocument) -> str:
    from .model import dump_legacy_python_document, cell_member_names
    # Reuse the complete cell codec, including resource snapshots and linked helpers.
    document = canonical_actions(document)
    legacy = dump_legacy_python_document(document)
    tree = ast.parse(legacy)
    model = next(node for node in tree.body if isinstance(node, ast.ClassDef) and any(isinstance(marker, ast.Call) and isinstance(marker.func, ast.Name) and marker.func.id == 'sheet' for marker in node.decorator_list))
    marker = next(item for item in model.decorator_list if isinstance(item, ast.Call))
    config = dict(as_mapping(ast.literal_eval(marker.args[0])) or {})
    config.pop('sheetName', None)
    config.pop('sheets', None)
    config.pop('grid', None)
    layout = dict(as_mapping(config.pop('layout', {})) or {})
    config['layout'] = {key: value for key, value in layout.items() if key in ('noteOrder', 'noteParents')}
    environment = dict(as_mapping(config.get('environment', {})) or {})
    environment.pop('packages', None)  # PEP 723 holds them
    config['environment'] = {key: value for key, value in environment.items() if value not in ({}, '', None)}
    flat = cell_member_names(document.cells, {action.name for action in document.actions})
    local = local_member_names(document.cells)
    paths = workbook_member_names(document.cells, document.sheet_name)
    by_member = {member: cell for cell in document.cells for member in [flat[cell.id]]}
    owners: dict[str, str] = {member: split_cell_id(cell.id)[0] for member, cell in by_member.items()}
    helpers: dict[str, str] = {}
    for node in model.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Attribute) and decorator.attr == 'loader' and isinstance(decorator.value, ast.Name) and decorator.value.id in owners:
                owners[node.name] = owners[decorator.value.id]
                helpers[node.name] = '_' + local[by_member[decorator.value.id].id] + '_loader'
            if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name) and decorator.func.id == 'linked' and node.name in by_member:
                for keyword in decorator.keywords:
                    if keyword.arg == 'computation' and isinstance(keyword.value, ast.Name):
                        owners[keyword.value.id] = owners[node.name]
                        helpers[keyword.value.id] = '_' + local[by_member[node.name].id] + '_computation'
    # Keep generated helper names collision-free within each worksheet.
    occupied = {prefix: {local[cell.id] for cell in document.cells if split_cell_id(cell.id)[0] == prefix} for prefix in owners.values()}
    for old, helper in list(helpers.items()):
        while helper in occupied[owners[old]]:
            helper = '_' + helper
        occupied[owners[old]].add(helper)
        helpers[old] = helper
    root_name = model.name.removesuffix('Sheet') + 'Workbook'
    classes: list[str] = []
    declarations: list[str] = []
    occupied_classes = {node.name for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))} | {root_name}
    tabs = [(document.sheet_name, '', {'columns': document.columns, 'rows': document.rows}, {key:value for key,value in layout.items() if key not in ('noteOrder','noteParents')})]
    tabs += [(tab.name, tab.name, {'columns':tab.columns, 'rows':tab.rows}, {'columnWidths':tab.column_widths, 'rowHeights':tab.row_heights}) for tab in document.sheets]
    action_names = {action.name for action in document.actions}
    if action_names & {name for name, *_ in tabs}:
        raise ValueError('Workbook actions and worksheet symbols must have distinct names')
    for name, prefix, grid, tab_layout in tabs:
        class_name = name + 'Worksheet'
        while class_name in occupied_classes:
            class_name = '_' + class_name
        occupied_classes.add(class_name)
        members: list[str] = []
        mapping = {old: local[cell.id] for old, cell in by_member.items() if owners[old] == prefix}
        mapping.update({old: new for old, new in helpers.items() if owners[old] == prefix})
        references = {f'self.{old}': f'self.{local[cell.id]}' if owners[old] == prefix else f'self.workbook.{paths[cell.id]}' for old, cell in by_member.items()}
        references.update({f'self.{action.name}': f'self.workbook.{action.name}' for action in document.actions})
        for node in model.body:
            old = member_name(node)
            if old is None or owners.get(old) != prefix:
                continue
            source = rewrite_attributes(member_source(legacy, node), references, markdown=old in by_member and by_member[old].kind == 'markdown')
            source = rename_declarations(source, mapping)
            module = ast.parse(source)
            edits: list[tuple[ast.AST,str]] = []
            for item in module.body:
                call = cell_call(item)
                if call and call.args and isinstance(call.args[0], ast.Constant):
                    edits.append((call.args[0], json.dumps(split_cell_id(str(call.args[0].value))[1])))
            members.append(textwrap.indent(format_members(edit_nodes(source, edits).rstrip()), '    '))
        header = f'class {class_name}(Worksheet["{root_name}"]):'
        if len(header) > LINE_LENGTH:  # split like ruff
            header = f'class {class_name}(\n    Worksheet["{root_name}"]\n):'
        classes.append(header + '\n' + ('\n\n'.join(members) if members else '    pass'))
        declarations.append(worksheet_declaration(name, class_name, grid, tab_layout))
    methods: list[str] = []
    for action in document.actions:
        method = rewrite_members(action, paths)
        decorator = '@action' + (f'(label={py_string(action.label)})' if action.label else '')
        methods.append(textwrap.indent(format_members((decorator + '\n' if action.exposed else '') + method.rstrip()), '    '))
    config = {'formatVersion': PYTHON_FORMAT_VERSION, **{key: value for key, value in config.items() if key != 'formatVersion' and value != {}}}
    marker_source = 'workbook_config(' + repr(config) + ')'
    root = '\n'.join(layout_lines(marker_source, 0, '@')) + f'\nclass {root_name}(Workbook):\n' + '\n'.join(declarations)
    if methods:
        root += '\n\n' + '\n\n'.join(methods)
    body = '\n\n\n'.join([*classes, root])
    footer = 'if __name__ == "__main__":\n    from reaktiv_workbook.cli import main\n\n    raise SystemExit(main([__file__]))'
    return file_header(document, body) + '\n\n\n' + body + '\n\n\n' + footer + '\n'


# Grid and layout values `worksheet()` assumes when they are left out.
DEFAULT_GRID: dict[str, object] = {'columns': 10, 'rows': 16}
DEFAULT_LAYOUT: dict[str, object] = {'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0}


def worksheet_declaration(name: str, class_name: str, grid: Mapping[str, Any], tab_layout: Mapping[str, Any]) -> str:
    """`Name = worksheet(NameWorksheet, …)`, leaving out default grid and layout values."""
    settings = {key: value for key, value in tab_layout.items() if DEFAULT_LAYOUT.get(key, object()) != value}
    arguments = [class_name, *([f'grid={dict(grid)!r}'] if dict(grid) != DEFAULT_GRID else []), *([f'layout={settings!r}'] if settings else [])]
    return '\n'.join(layout_lines('worksheet(' + ', '.join(arguments) + ')', 4, f'{name} = '))


def layout_lines(expression: str, column: int, head: str) -> list[str]:
    """Generated literal code laid out like ruff (see source_layout)."""
    node = ast.parse(expression, mode='eval').body
    return layout(expression, node, column, head)


# Names the header imports only when the file uses them.
_CORE_NAMES = ('computed', 'effect', 'field', 'resource', 'linked', 'ReactiveModel')
_WORKBOOK_NAMES = ('Artifact', 'Workbook', 'Worksheet', 'action', 'artifact', 'at', 'bind', 'cell', 'cell_refs',
                   'every', 'html', 'input_cell', 'markdown', 'workbook_config', 'worksheet')
_MODULES = (('asyncio', 'import asyncio'), ('math', 'import math'), ('statistics', 'import statistics'), ('np', 'import numpy as np'))


def import_line(module: str, names: Sequence[str]) -> str:
    """`from module import …`, one name per line when too long (as ruff writes it)."""
    line = f'from {module} import {", ".join(names)}'
    if len(line) <= LINE_LENGTH:
        return line
    return f'from {module} import (\n' + ''.join(f'    {name},\n' for name in names) + ')'


def file_header(document: SheetDocument, body: str) -> str:
    """PEP 723 metadata, the imports the file uses, `env` when needed and shared code."""
    from .model import SHARED_CODE_MARKER, script_metadata_block
    code = document.code or ''
    text = '\n'.join([*document.imports, code, body])
    used = {node.id for node in ast.walk(ast.parse(text)) if isinstance(node, ast.Name)}
    # Notes and widget settings can use the kernel's preloaded modules inside strings too.
    modules = [line for name, line in _MODULES if re.search(rf'\b{name}\s*\.', text)]
    core = [name for name in _CORE_NAMES if name in used]
    workbook = [name for name in _WORKBOOK_NAMES if name in used]
    needs_env = bool(document.variables) or re.search(r'\benv\b', text) is not None
    imports = [*modules, *document.imports]
    # numpy is not a dependency of reaktiv-workbook: a file that imports it declares it.
    numpy = (re.search(r'^\s*(?:import|from)\s+numpy\b', '\n'.join([*modules, text]), re.MULTILINE) is not None
             and not any(re.match(r'(?i)numpy(?![\w.-])', package.strip()) for package in document.packages))
    blocks = [script_metadata_block(document.packages, document.python, numpy=numpy), '"""A Reaktiv Workbook (Python format 2)."""']
    blocks.append('\n'.join([*imports, *([''] if imports else []), *([import_line('reaktiv', core)] if core else []),
                             import_line('reaktiv_workbook', workbook)]))
    if needs_env:
        blocks.append('env = ' + json.dumps(dict(document.variables), ensure_ascii=False))
    text = '\n\n'.join(blocks)
    if code:
        first = next(iter(ast.parse(code).body), None)
        # Ruff puts two blank lines before a top-level def/class and the comment above it.
        gap = '\n\n\n' if isinstance(first, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else '\n\n'
        text += gap + SHARED_CODE_MARKER + '\n' + code.strip('\n')
    return text


def legacy_header(module: ast.Module, source: str, first_line: int, config: Mapping[str, Any]) -> str:
    """The format-2 header rewritten as the format-1 loader expects it: imports, then
    `env = …`, then shared code. Format-2 files only write `env` when needed and mark
    shared code with its comment (or start it at the first statement after the imports)."""
    from .model import SHARED_CODE_MARKER
    lines = source.splitlines()[:first_line]
    nodes = [node for node in module.body if node.lineno <= first_line]
    if any(isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'env' for target in node.targets) for node in nodes):
        return '\n'.join(lines)  # written with `env = …`: already the legacy layout
    marker = next((index for index, line in enumerate(lines) if line.strip() == SHARED_CODE_MARKER), None)
    if marker is None:
        code_start = next((node.lineno - 1 for node in nodes if not isinstance(node, (ast.Import, ast.ImportFrom))
                           and not (node is module.body[0] and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant))), first_line)
    else:
        code_start = marker + 1
    environment = as_mapping(config.get('environment', {})) or {}
    variables = as_mapping(environment.get('variables', {})) or {}
    code = '\n'.join(lines[code_start:]).strip('\n')
    return '\n'.join([*lines[:marker if marker is not None else code_start],
                      'env = ' + json.dumps(dict(variables), ensure_ascii=False), *([SHARED_CODE_MARKER, code, ''] if code else [])])


def load_document(source: str) -> SheetDocument:
    from .model import CellDefinition, cell_member_names, load_legacy_model_document, logical_cell_label, normalize_cells
    module = ast.parse(source)
    roots = [(node, marker) for node in module.body if isinstance(node, ast.ClassDef) for marker in [workbook_marker(node)] if marker is not None]
    if len(roots) != 1:
        raise ValueError('Workbook format 2 requires exactly one @workbook class')
    root, marker = roots[0]
    if len(root.bases) != 1 or attribute_path(root.bases[0]) != 'Workbook':
        raise ValueError('The @workbook class must inherit directly from Workbook')
    if len(marker.args) != 1 or marker.keywords:
        raise ValueError('@workbook requires one literal metadata mapping')
    config = dict(as_mapping(ast.literal_eval(marker.args[0])) or {})
    if config.pop('formatVersion', None) != PYTHON_FORMAT_VERSION:
        raise ValueError('Unsupported Python workbook formatVersion; expected 2')
    classes = {node.name: node for node in module.body if isinstance(node, ast.ClassDef)}
    tabs: list[tuple[str, ast.ClassDef, dict[str, Any]]] = []
    for node in root.body:
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call) or not isinstance(node.value.func, ast.Name) or node.value.func.id != 'worksheet':
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Pass)) or isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            raise ValueError('Workbook members must be worksheet declarations or action/helper methods')
        name = member_name(node)
        call = node.value
        if name is None or not valid_sheet_name(name) or len(call.args) != 1 or not isinstance(call.args[0], ast.Name):
            raise ValueError('Worksheet declarations must be name = worksheet(WorksheetClass, ...)')
        if name in {'dispose', 'worksheet_names', 'worksheet_instance', 'workbook'}:
            raise ValueError(f'Reserved worksheet symbol: {name}')
        declaration = classes.get(call.args[0].id)
        if declaration is None:
            raise ValueError(f'Unknown worksheet class: {call.args[0].id}')
        bases = declaration.bases
        base = bases[0].value if len(bases) == 1 and isinstance(bases[0], ast.Subscript) else bases[0] if len(bases) == 1 else None
        if base is None or attribute_path(base) != 'Worksheet':
            raise ValueError(f'Worksheet {name} must inherit directly from Worksheet')
        settings = {item.arg: ast.literal_eval(item.value) for item in call.keywords if item.arg is not None}
        if any(item.arg is None for item in call.keywords) or set(settings) - {'grid', 'layout'}:
            raise ValueError('worksheet() supports literal grid and layout metadata')
        if any(old == name for old, *_ in tabs):
            raise ValueError(f'Duplicate worksheet symbol: {name}')
        # Independent instances require distinct declaration classes in this first format.
        if any(old_class is declaration for _, old_class, _ in tabs):
            raise ValueError('Use a separate worksheet class for an independent copy')
        tabs.append((name, declaration, settings))
    if not tabs:
        raise ValueError('A workbook must declare at least one worksheet')
    sheet_symbols = {name for name, _, _ in tabs}
    for node in root.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in sheet_symbols:
            raise ValueError('Workbook actions and worksheet symbols must have distinct names')
    first = tabs[0][0]
    definitions: list[CellDefinition] = []
    originals: dict[tuple[str, str], str] = {}
    for name, declaration, _ in tabs:
        positions: set[str] = set()
        for node in declaration.body:
            call, member = cell_call(node), member_name(node)
            if call is None or member is None:
                continue
            if not call.args or not isinstance(call.args[0], ast.Constant) or not isinstance(call.args[0].value, str):
                raise ValueError('Cell positions must be literal local coordinates')
            coordinate = call.args[0].value
            if not re.fullmatch(r'[A-Z]+[1-9][0-9]*', coordinate) or coordinate in positions:
                raise ValueError(f'Invalid or duplicate cell position on {name}: {coordinate}')
            positions.add(coordinate)
            cell_id = qualify('' if name == first else name, coordinate)
            label = logical_cell_label(call, member, coordinate)
            definitions.append(CellDefinition(cell_id, 'formula', 'None', name=label))
            originals[(name, member)] = cell_id
    flat = cell_member_names(normalize_cells(definitions), {node.name for node in root.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))})
    root_refs = {f'self.{name}.{member}': f'self.{flat[cell_id]}' for (name, member), cell_id in originals.items()}
    members: list[str] = []
    for name, declaration, _ in tabs:
        renames = {member: flat[cell_id] for (sheet, member), cell_id in originals.items() if sheet == name}
        helpers: dict[str, str] = {}
        for node in declaration.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Attribute) and decorator.attr == 'loader' and isinstance(decorator.value, ast.Name) and decorator.value.id in renames:
                    helpers[node.name] = f'__{name}_{node.name}'
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name) and decorator.func.id == 'linked':
                    for keyword in decorator.keywords:
                        if keyword.arg == 'computation' and isinstance(keyword.value, ast.Name):
                            helpers[keyword.value.id] = f'__{name}_{keyword.value.id}'
        renames.update(helpers)
        refs = {f'self.{member}': f'self.{flat[cell_id]}' for (sheet, member), cell_id in originals.items() if sheet == name}
        refs.update({key.replace('self.', 'self.workbook.', 1): value for key, value in root_refs.items()})
        refs.update({f'self.workbook.{node.name}': f'self.{node.name}' for node in root.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))})
        for node in declaration.body:
            member = member_name(node)
            if member is None:
                if isinstance(node, ast.Pass) or isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                    continue
                raise ValueError(f'Unsupported declaration in worksheet {name}')
            if member not in renames:
                raise ValueError(f'Worksheet {name}.{member}: declare a cell, or put shared helpers at module level')
            text = rewrite_attributes(member_source(source, node), refs, markdown=isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(isinstance(marker, ast.Name) and marker.id == 'markdown' for marker in node.decorator_list))
            text = rename_declarations(text, renames)
            tree = ast.parse(text)
            edits: list[tuple[ast.AST, str]] = []
            for item in tree.body:
                call = cell_call(item)
                if call and call.args and isinstance(call.args[0], ast.Constant):
                    edits.append((call.args[0], repr(qualify('' if name == first else name, str(call.args[0].value)))))
                    if not any(keyword.arg == 'label' for keyword in call.keywords):
                        label = logical_cell_label(call, member, str(call.args[0].value))
                        # The call may be split over lines with a trailing comma (ruff layout).
                        arguments = (ast.get_source_segment(text, call) or '')[:-1].rstrip().removesuffix(',')
                        edits.append((call, arguments + f', label={label!r})'))
            # Position and label belong to the same call: apply the outer edit first,
            # then qualify the still-local coordinate on the next parse.
            text = edit_nodes(text, edits)
            edits = []
            for item in ast.parse(text).body:
                call = cell_call(item)
                if call and call.args and isinstance(call.args[0], ast.Constant):
                    coordinate = str(call.args[0].value)
                    if '!' not in coordinate:
                        edits.append((call.args[0], repr(qualify('' if name == first else name, coordinate))))
            members.append(textwrap.indent(edit_nodes(text, edits), '    '))
    # In actions `self` is the workbook, so `self.workbook.Sheet.member` (the spelling cells
    # use) means the same as `self.Sheet.member`.
    action_refs = {**root_refs, **{key.replace('self.', 'self.workbook.', 1): value for key, value in root_refs.items()},
                   **{f'self.workbook.{node.name}': f'self.{node.name}' for node in root.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}}
    for node in root.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            members.append(textwrap.indent(rewrite_action_attributes(member_source(source, node), action_refs, decorated=True), '    '))
    config['sheetName'] = first
    config['grid'] = tabs[0][2].get('grid', {'columns':10, 'rows':16})
    config['layout'] = {**dict(as_mapping(tabs[0][2].get('layout', {})) or {}), **dict(as_mapping(config.get('layout', {})) or {})}
    config['sheets'] = [{'name':name, **settings} for name, _, settings in tabs[1:]]
    managed = {id(root), *(id(declaration) for _, declaration, _ in tabs)}
    first_line = min(min([node.lineno, *(item.lineno for item in node.decorator_list)]) for node in module.body if id(node) in managed and isinstance(node, ast.ClassDef)) - 1
    for node in module.body:
        if node.lineno <= first_line or id(node) in managed:
            continue
        # The generated executable entry point is the only post-composition statement.
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and attribute_path(node.test.left) == '__name__' and len(node.test.comparators) == 1 and isinstance(node.test.comparators[0], ast.Constant) and node.test.comparators[0].value == '__main__':
            continue
        raise ValueError('Put imports and shared code before worksheet classes; unsupported module code after composition')
    header = legacy_header(module, source, first_line, config)
    flattened = header + f'\n@sheet({config!r})\nclass {root.name}(ReactiveModel):\n' + ('\n\n'.join(members) if members else '    pass') + '\n'
    return canonical_actions(load_legacy_model_document(flattened))
