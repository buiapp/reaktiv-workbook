# Scrollable graph levels

Enable **Graph → Scrollable levels** to keep each dependency level in a bounded
panel. Horizontal graphs scroll each column vertically; vertical graphs scroll
each row horizontally. Level headers stay visible while their cards scroll.
The normal canvas remains available by disabling the option.

By default, **Connections → Selected cell** shows only direct incoming and outgoing
arrows for the selected cell: purple for dependencies, green for dependents. Select
a card to explore its connections without moving the other cards. Choose **All**
for the full network. The normal canvas continues to show all connections.

Enable **Inputs first** to keep source inputs in the first level, in either view
and direction. It is off by default, keeping inputs near their earliest consumer.
Linked inputs with dependencies remain after their dependencies. Changing this
setting releases the current pane's pin; other pins retain their captured layout.
Both preferences are remembered on this device.

Arrows follow the visible card positions. Connections to endpoints outside a
panel's visible area use dashed strokes and are clamped to its boundary. Widget
configuration connections also retain their existing dashed style. Connections
with both endpoints hidden are not drawn. Header buttons count connected cells
above/below or left/right. Click a button to reveal and select the nearest hidden
connected cell in that direction. These counts follow the Connections setting and cover observed graph connections,
including connections represented in a pinned layout; they are not cell counts
from Python execution or dependency depth numbers.

Selecting a different cell reveals it within its level. Each pane retains its own
scroll offsets, separately for horizontal and vertical directions. Positions follow
pane swaps, survive toggling the option and reset when the document's graph views
are reset. Filters, viewport size and zoom clamp offsets to the available extent.

The toolbar's Fit command fits the axis containing the levels. Within each level,
native scrollbars and keyboard scrolling remain available. Widgets and charts keep
their existing gestures; Ctrl/Cmd+wheel over the level background changes graph zoom.
Card resizing reflows the layout once on commit, including pinned layouts.

## Ownership and rendering

`GraphWorkspace` owns the preference and per-pane `GraphLevelScrollState`. The state
contains offsets and selection presentation intent only. Pins keep their captured
nodes/connections/direction; scrolling does not mutate their graph geometry or read
cell signals. Existing node and edge templates render both the normal canvas and
the level panels, so values, widgets, error/trace styles and inspect/edit commands
remain shared.

`graphLevels` groups existing layout geometry. `projectGraphLevels` computes visible
endpoints and indicators from native scroll offsets and measured viewport size.
Structure is cached per layout; scroll changes project nodes and edges once per
animation frame. DOM observers only measure the viewport and disconnect on teardown.
The view does not evaluate cells, parse rich output payloads, or change workbook
source, dirty state or undo history. It does not add demand-based evaluation.
