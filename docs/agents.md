# Agents (MCP)

Coding agents such as Claude Code, Cursor or OpenCode can work in a workbook you have
open: read cells, add or change them, run actions, and look at charts. You watch their
changes live, and each batch of agent edits is one undo step.

## Connect an agent

```bash
reaktiv-workbook edit analysis.workbook.py --mcp
```

The first time, the terminal prints the MCP URL (`http://127.0.0.1:8766/mcp`) and an
`Authorization: Bearer …` header. Add both to your agent's MCP configuration once. The
token is saved (`~/.config/reaktiv-workbook/mcp-token` on Linux) and reused, so every
workbook you open with `--mcp` uses the same URL and token.

For Claude Code:

```bash
claude mcp add --transport http reaktiv-workbook http://127.0.0.1:8766/mcp \
  --header "Authorization: Bearer <token>"
```

Then ask the agent about "this workbook" or "this cell": it can see which note, sheet
and cells you are looking at.

## What agents can do

| Area | Tools |
| --- | --- |
| Find and read | `list_workbooks`, `get_user_context`, `get_workbook_overview`, `read_workbook`, `inspect_cells`, `get_dependencies` |
| Edit | `edit_cells`, `set_cell_label`, `move_cells`, `set_cell_view`, `set_cell_colors` |
| Sheets and layout | `manage_worksheet`, `resize_worksheet`, `set_worksheet_layout`, `inspect_cell_layout` |
| Environment | `get_workbook_environment`, `update_workbook_environment`, `add_image` |
| Actions | `list_actions`, `upsert_action`, `run_action`, `cancel_action` |
| Debug | `get_logs`, `get_diagnostics`, `get_kernel_status`, `control_kernel`, `inspect_visual` |
| Save | `save_workbook` |

The bundled authoring guide teaches agents the workbook model. It is available as the
MCP prompt `workbook_authoring`, the resource
`reaktiv-workbook://skills/workbook-authoring`, and the tool `get_authoring_guide`. If
your agent doesn't load it by itself, ask it to call `get_authoring_guide` first.

## Staying in control

- Agents never overwrite your unapplied edits: an edit that touches one of your drafts
  is refused.
- **Agent activity** in the status bar lists recent requests; cells agents created or
  changed are marked **Agent +** and **Agent ✎**.
- **Undo** reverses an agent's batch. External effects of running an action (files,
  messages) can't be undone.
- Agents don't save unless asked. **Stop sharing this workbook** in *Agent access* ends
  access; closing the window does too.

## Other setups

**Workbooks opened in the web app.** A browser page can't start a server, so start one
yourself and connect from *Agent access*:

```bash
reaktiv-workbook-mcp --port 8766
```

Add `--app-origin https://your-app.example` for a hosted app.

**An agent on another machine.** The server listens only on your computer by default.
The safest way in is an SSH tunnel from the agent's machine:

```bash
ssh -N -L 8766:127.0.0.1:8766 user@workbook-host
```

To listen on the network instead (only on a trusted network or VPN), start the server
with `--host 0.0.0.0 --allowed-host <server address>`; agents then use
`http://<server address>:8766/mcp`. The token is still required.

**OpenCode.** *Agent access → Copy OpenCode HTTP configuration* produces the
configuration for `opencode.json`.

## Security

The token gives full access to the shared workbooks, including running Python. Keep it
private; delete the token file to issue a new one. Only workbooks you explicitly share
are visible, and sharing ends when the window closes.
