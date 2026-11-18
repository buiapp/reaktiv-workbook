"""Built-in widget settings: literals, expressions, and validated resolved values."""
from __future__ import annotations

import math
from typing import Any, Mapping
from .actions import validate_action_bindings
from .narrowing import as_mapping, as_sequence

WIDGET_TYPES = frozenset({'checkbox', 'number', 'range', 'select', 'text', 'textarea', 'date', 'list', 'multiselect', 'radio', 'button', 'file', 'folder'})
NUMERIC_SETTINGS = ('min', 'max', 'step')
TEXT_SETTINGS = ('label', 'placeholder')
STATE_SETTINGS = ('disabled', 'visible', 'loading', 'pressed')
WIDGET_SETTINGS = (*NUMERIC_SETTINGS, 'options', *TEXT_SETTINGS, *STATE_SETTINGS)
# Fixed settings (never expressions), kept as written.
STATIC_SETTINGS = ('buttonMode', 'action', 'actionArguments', 'cancelWhileRunning', 'debounce')
# Milliseconds a slider, text or number field waits after the last change before its input
# cell updates while still being edited; 0 updates on every change. Unset: sliders 150 ms,
# text and number fields when the edit is committed (Enter or leaving the field).
MAX_DEBOUNCE = 10_000


def widget_expression(key: str, value: Any) -> str | None:
    """Strings in numeric/options fields are expressions; other fields use {expr: …}."""
    mapping = as_mapping(value)
    if mapping is not None and set(mapping) == {'expr'}:
        expression = mapping['expr']
        if not isinstance(expression, str) or not expression.strip():
            raise ValueError('Widget expression must be nonempty Python')
        return expression
    if key in (*NUMERIC_SETTINGS, 'options') and isinstance(value, str):
        return value
    return None


def validate_widget(widget: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a resolved configuration without changing the input value."""
    resolved = dict(widget)
    for key in NUMERIC_SETTINGS:
        value = resolved.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
            raise ValueError(f'Widget {key} must evaluate to a finite number')
    if resolved.get('step', 1) <= 0:
        raise ValueError('Widget step must be positive')
    if 'min' in resolved and 'max' in resolved and resolved['min'] > resolved['max']:
        raise ValueError('Widget min must not exceed max')
    if 'options' in resolved:
        options = as_sequence(resolved['options'])
        if options is None or len(options) > 1000 or not all(isinstance(item, str) for item in options):
            raise ValueError('Widget options must evaluate to a list of at most 1000 strings')
        if len(set(options)) != len(options):
            raise ValueError('Widget options must be unique')
        resolved['options'] = list(options)
    for key in TEXT_SETTINGS:
        if key in resolved and (not isinstance(resolved[key], str) or len(resolved[key]) > 2048):
            raise ValueError(f'Widget {key} must evaluate to text of at most 2048 characters')
    for key in STATE_SETTINGS:
        if key in resolved and not isinstance(resolved[key], bool):
            raise ValueError(f'Widget {key} must evaluate to True or False')
    if resolved.get('buttonMode', 'count') not in {'count', 'toggle', 'action'}:
        raise ValueError('Widget buttonMode must be count, toggle, or action')
    if 'action' in resolved or resolved.get('buttonMode') == 'action':
        target = resolved.get('action')
        if resolved.get('type') != 'button' or not isinstance(target, str) or not target.isidentifier() or target.startswith('_'):
            raise ValueError('Action buttons must name a public action')
        resolved['buttonMode'] = 'action'
    if 'cancelWhileRunning' in resolved:
        if not isinstance(resolved['cancelWhileRunning'], bool) or resolved.get('buttonMode') != 'action':
            raise ValueError('Widget cancelWhileRunning requires an action button and a Boolean')
    if 'debounce' in resolved:
        delay = resolved['debounce']
        if isinstance(delay, bool) or not isinstance(delay, int) or not 0 <= delay <= MAX_DEBOUNCE:
            raise ValueError(f'Widget debounce must be whole milliseconds from 0 to {MAX_DEBOUNCE}')
    if 'actionArguments' in resolved:
        if resolved.get('buttonMode') != 'action':
            raise ValueError('Action arguments require an action button')
        resolved['actionArguments'] = validate_action_bindings(resolved['actionArguments'])
    return resolved


def normalize_widget(value: Any, cell_id: str = '') -> dict[str, Any]:
    widget = as_mapping(value)
    if widget is None or widget.get('type') not in WIDGET_TYPES:
        raise ValueError(f'Cell {cell_id} widget type must be one of {sorted(WIDGET_TYPES)}')
    result: dict[str, Any] = {'type': widget['type']}
    static: dict[str, Any] = {'type': widget['type']}
    for key in WIDGET_SETTINGS:
        raw = widget.get(key)
        if raw is None:
            continue
        expression = widget_expression(key, raw)
        if expression is not None:
            result[key] = expression if key in (*NUMERIC_SETTINGS, 'options') else {'expr': expression}
        else:
            result[key] = raw
            static[key] = raw
    for key in STATIC_SETTINGS:
        if key in widget:
            result[key] = static[key] = widget[key]
    # Bounds may depend on dynamic settings; validate their ordering only at evaluation.
    for key in NUMERIC_SETTINGS:
        raw = static.get(key)
        if raw is not None and (isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw)):
            raise TypeError(f'Cell {cell_id} widget {key} must be a number or Python expression')
    other = {key: raw for key, raw in static.items() if key not in NUMERIC_SETTINGS}
    other = validate_widget(other)
    for key in ('options', 'buttonMode', 'actionArguments'):
        if key in other:
            result[key] = other[key]
    # One fixed key order, so normalizing (and saving) twice gives the same file.
    order = ('type', *WIDGET_SETTINGS, *STATIC_SETTINGS)
    return {key: result[key] for key in order if key in result}
