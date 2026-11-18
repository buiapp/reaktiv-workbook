# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "pandas",
#   "plotly",
#   "anywidget",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import math

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    action,
    bind,
    cell,
    html,
    markdown,
    workbook_config,
    worksheet,
)


class BoardWorksheet(Worksheet["ProjectPlannerWorkbook"]):
    # your tasks, one per line (syntax in the first lines)
    task_text = cell(
        "A1",
        field(
            '// One task per line:  [status] Title !priority @area #project due:YYYY-MM-DD est:hours started:YYYY-MM-DD done:YYYY-MM-DD\n// status: backlog, todo, doing, review, done · priority: !high !med !low · area: @work or @life · lines starting with // are comments\n// indented lines right below a task are its notes\n[doing] Write launch announcement !high @work #launch due:2026-10-07 est:3 started:2026-10-02\n[doing] Fix checkout bug on mobile !high @work #launch due:2026-10-06 est:2 started:2026-10-03\n[doing] Reply to partner emails !med @work #ops est:1 started:2026-10-05\n[doing] Research a new laptop !low @life #home est:2 started:2026-09-30\n[review] New pricing page copy !med @work #launch est:2 started:2026-09-29\n[todo] Send invoice to client !high @work #finance due:2026-10-02 est:0.5\n[todo] Prepare investor update !high @work #finance due:2026-10-10 est:4\n    Use the Q3 numbers from the budget review.\n    Ask the hiring lead for the team-plan slide.\n[todo] Interview two backend candidates !med @work #hiring due:2026-10-08 est:3\n[todo] Set up analytics dashboard !med @work #launch est:5\n[todo] Book dentist appointment !med @life #health due:2026-10-07 est:0.5\n[todo] Renew car insurance !high @life #finance due:2026-10-20 est:1\n[todo] Plan weekend hike with friends !low @life #fun due:2026-10-08 est:1\n[backlog] Rewrite onboarding emails !low @work #growth est:4\n[backlog] Draft hiring plan for Q1 !med @work #hiring est:3\n[backlog] Learn SQL window functions !low @life #learning est:6\n[backlog] Clear out the garage !low @life #home est:4\n[done] Choose launch date !high @work #launch est:1 started:2026-09-01 done:2026-09-03\n[done] Design new landing page !high @work #launch est:8 started:2026-09-02 done:2026-09-12\n[done] File tax return !high @life #finance est:3 started:2026-09-08 done:2026-09-10\n[done] Write job ad for backend role !med @work #hiring est:2 started:2026-09-09 done:2026-09-11\n[done] Set up staging server !med @work #launch est:4 started:2026-09-14 done:2026-09-17\n[done] Run a 10 km practice race !med @life #health est:1 started:2026-09-20 done:2026-09-20\n[done] Five customer interviews !high @work #launch est:6 started:2026-09-15 done:2026-09-24\n[done] Fix the leaking tap !low @life #home est:1 started:2026-09-27 done:2026-09-27\n[done] Migrate blog to new design !med @work #launch est:5 started:2026-09-22 done:2026-09-30\n[done] Review Q3 budget !med @work #finance est:2 started:2026-09-29 done:2026-10-01\n[done] Call grandma !med @life #family est:0.5 started:2026-10-03 done:2026-10-03'
        ),
        label="task_text",
        view={"widget": {"type": "textarea"}},
    )

    @cell("B1", label="today")
    @computed
    def today(self):
        import datetime as dt
        return dt.date.fromisoformat(self.today_override()) if self.today_override().strip() else dt.date.today()

    @cell("C1", label="board", view={"display": "rendered", "span": [5, 12]})
    @computed
    def board(self):
        # the board shows the task list and writes changes back to it (bind)
        return bind(self.KanbanBoard()(cards=self.board_cards(), columns=[[label, status] for label, status in self.board_columns().items()],
                         wip=self.wip_limits(), today=self.today().isoformat(), done_shown=self.done_shown()), text=self.task_text())

    @cell("H1", label="board_note")
    @markdown
    def board_note(self):
        return """# Your board

        **Today is {{ f'{self.today():%A, %d %B %Y}' }}.** {{ len(self.columns()['Doing']) }} cards in progress, {{ len(self.columns()['To do']) }} ready, {{ len(self.workbook.Priorities.overdue()) }} overdue.

        {{ self.kpis() }}

        > {{ self.wip_text() }}

        ## Focus for today

        {{ self.workbook.Priorities.focus_list() }}

        ## The board

        [Show: {{ self.area_filter() }}](#sheet-input:area_filter?type=select&options=All,Work,Life)

        [{{ self.board() }}](#sheet-output?layout=wide)

        Card edge: red = high, yellow = medium, green = low priority · 🏠 life · ⏰ overdue

        ## Your tasks

        **Drag a card to another column** (or use its ‹ › buttons, which also work by touch and keyboard),
        and **type at the bottom of Backlog or To do** to add a task. Moving a card into Doing adds
        `started:` with today's date, into Done adds `done:` — the forecast and cycle time need them.

        The board is a view of the task list below: it writes your changes into it, and you can edit the
        list directly too. The matrix, the forecast and the statistics follow at once.

        [Tasks: {{ self.task_text() }}](#sheet-input:task_text?type=textarea)

        | Write | Meaning |
        | --- | --- |
        | `[doing]` at the start | Column: `backlog`, `todo`, `doing`, `review`, `done` |
        | `!high` `!med` `!low` | Priority (default: medium) |
        | `@work` `@life` | Area (default: work) |
        | `#launch` | Project |
        | `due:2026-10-12` | Due date |
        | `est:2` | Estimate in hours |
        | `started:…` `done:…` | When you started and finished: used for cycle time and throughput |
        | indented lines below a task | Its notes (📝 on the card) |

        {{ self.syntax_problems() }}

        [Treat as today (empty = the real date): {{ self.today_override() }}](#sheet-input:today_override?type=text)

        > **How the board works:** it is an [anywidget](https://anywidget.dev) (cell `KanbanBoard`) bound to
        > the input cell `task_text`: `bind(KanbanBoard(cards=…), text=task_text)`. The task list stays the
        > data — saved in the file, undoable, readable by every other cell — and the board only shows it
        > and writes changes back. The KPIs and the Eisenhower matrix are HTML cells: they only display.

        ---

        **Read on:** [How Kanban works](#note-kanban_note) · [Prioritise](#note-priorities_note) ·
        [Plan your week](#note-planning_note) · [Goals and habits](#note-goals_note) ·
        [Weekly review](#note-review_note) · [Decide better](#note-decision_note)"""

    # work in progress limits per column
    wip_limits = cell("A2", field({'Doing': 3, 'Review': 2}), label="wip_limits")

    @cell("B2", label="parse_task")
    @computed
    def parse_task(self):
        def parse_task(line):
            """One line of the task list as a dict (unknown words stay in the title)."""
            import datetime as dt
            import re
            task = {'status': 'todo', 'priority': 'med', 'area': 'work', 'project': '', 'due': None,
                    'estimate': None, 'started': None, 'done': None}
            match = re.match(r'\s*\[(\w+)\]\s*(.*)', line)
            if match:
                task['status'], line = match.group(1).lower(), match.group(2)
            words = []
            for word in line.split():
                if word.startswith('!') and len(word) > 1:
                    task['priority'] = {'h': 'high', 'm': 'med', 'l': 'low'}.get(word[1].lower(), 'med')
                elif word.startswith('@') and len(word) > 1:
                    task['area'] = word[1:].lower()
                elif word.startswith('#') and len(word) > 1:
                    task['project'] = word[1:]
                elif re.match(r'(due|started|done):\d{4}-\d{2}-\d{2}$', word):
                    key, value = word.split(':')
                    task[key] = dt.date.fromisoformat(value)
                elif re.match(r'est:[\d.]+h?$', word):
                    task['estimate'] = float(word[4:].rstrip('h'))
                else:
                    words.append(word)
            task['title'] = ' '.join(words)
            return task

        return parse_task

    @cell("H2", label="kanban_note")
    @markdown
    def kanban_note(self):
        return """# How Kanban works

        Kanban (Japanese for "signboard") comes from Toyota's factories in the 1940s; software teams
        adopted it in the 2000s. It is not a schedule but a way to **see your work and keep it
        flowing**. It works for a team, a project, or your personal life.

        ## The core practices

        1. **Visualise the work.** Every task is a card; every stage is a column. What is invisible
           cannot be managed — a board shows at a glance what waits, what moves, and what is stuck.
        2. **Limit work in progress (WIP).** Each active column has a maximum number of cards. Your
           limits: {{ ', '.join((f'{column} {limit}' for column, limit in self.wip_limits().items())) }}. When a column is full,
           you **finish** something before you **start** something.
        3. **Manage the flow.** Watch how long cards take and where they pile up. A full Review
           column means reviewing is the bottleneck, not writing.
        4. **Make policies explicit.** Agree what "done" means for each column (e.g. *Review = someone
           else has read it*). Write it down.
        5. **Improve continuously.** Look at the numbers every week and change one thing.

        ## Why limiting WIP works

        Starting feels productive; finishing *is* productive. Every extra task in progress costs
        attention (switching between tasks can eat 20–40 % of your time) and makes **every** task
        take longer. **Little's Law** from queueing theory says it exactly:

        $$\\text{cycle time} = \\frac{\\text{work in progress}}{\\text{throughput}}$$

        With {{ self.workbook.Planning.wip_now() }} cards in progress and {{ self.workbook.Planning.avg_throughput() }} finished per week, a new card takes about
        **{{ self.workbook.Planning.littles_law_days() }} days** to get through. Halve the WIP and it takes half as long — without working
        any harder.

        ## Your columns

        | Column | Policy |
        | --- | --- |
        | **Backlog** | Ideas and someday tasks. Not committed. Review it weekly; delete freely. |
        | **To do** | Committed and ready: clear enough to start without asking anyone. |
        | **Doing** | Being worked on now. WIP limit {{ self.wip_limits().get('Doing', '—') }}. |
        | **Review** | Waiting for feedback, approval or testing. WIP limit {{ self.wip_limits().get('Review', '—') }}. |
        | **Done** | Finished — record the `done:` date so throughput and cycle time can be measured. |

        ## Best practices

        - **Stop starting, start finishing.** Pull a new card only when a slot is free.
        - **Small cards.** A card should take hours to a few days. Split anything larger
          ("Launch website" is a project; "Write announcement" is a task).
        - **Start with a verb.** "Call the dentist", not "Dentist".
        - **One board for work and life** works well for individuals: your energy is shared, so your
          WIP should be too. Use the filter to focus on one area.
        - **Blocked is a signal.** If a card waits on someone, say so in the title and chase it in the
          daily look at the board.
        - **WIP limits are experiments.** Start with *people × 1.5* for a team, 2–3 for one person,
          and adjust after a few weeks.
        - **Look at the board daily** (5 minutes: what is stuck, what can I finish today?) and review
          it weekly (see the [weekly review](#note-review_note)).

        ---

        **Previous:** [Your board](#note-board_note) · **Next:** [Prioritise](#note-priorities_note)"""

    # show work, life, or both
    area_filter = cell(
        "A3",
        field('All'),
        label="area_filter",
        view={"widget": {"type": "select", "options": ["All", "Work", "Life"]}},
    )

    @cell("B3", label="all_tasks")
    @computed
    def all_tasks(self):
        # every task with its line in task_text (the board widget edits it); indented lines
        # right below a task are its notes
        tasks_found = []
        for number, line in enumerate(self.task_text().splitlines()):
            if not line.strip() or line.strip().startswith('//'):
                continue
            if line[:1].isspace() and tasks_found and tasks_found[-1]['line'] + 1 + tasks_found[-1]['note_lines'] == number:
                task = tasks_found[-1]
                task['note'] = (task['note'] + '\n' + line.strip()).strip()
                task['note_lines'] += 1
                continue
            tasks_found.append({**self.parse_task()(line), 'line': number, 'note': '', 'note_lines': 0})
        return tasks_found

    # the date the planner treats as today; '' = the real date
    today_override = cell(
        "A4",
        field('2026-10-05'),
        label="today_override",
        view={"widget": {"type": "text"}},
    )

    @cell("B4", label="tasks")
    @computed
    def tasks(self):
        return [task for task in self.all_tasks() if self.area_filter() == 'All' or task['area'] == self.area_filter().lower()]

    # board columns, left to right, and the status word that puts a task there
    board_columns = cell(
        "A5",
        field(
            {'Backlog': 'backlog', 'To do': 'todo', 'Doing': 'doing', 'Review': 'review', 'Done': 'done'}
        ),
        label="board_columns",
    )

    @cell("B5", label="KanbanBoard")
    @computed
    def KanbanBoard(self):
        import anywidget
        import traitlets

        class KanbanBoard(anywidget.AnyWidget):
            """A Kanban board that edits the task list: drag a card (or use ‹ ›) to move it, 📝 to
            edit its notes, 🗑 to delete it, and type at the bottom of a column to add one. Bind
            `text` to the task list input cell."""

            _esm = """
            const h = (tag, className, text) => {
              const element = document.createElement(tag);
              if (className) element.className = className;
              if (text !== undefined) element.textContent = text;
              return element;
            };
            const ORDER = { high: 0, med: 1, low: 2 };

            function render({ model, el }) {
              const board = h("div", "board");
              el.append(board);
              let dragged = null;

              const save = (lines) => { model.set("text", lines.join("\\n")); model.save_changes(); };

              // Change the status word of the card's line; add started:/done: dates on the way.
              const move = (card, status) => {
                if (card.status === status) return;
                const lines = model.get("text").split("\\n");
                const today = model.get("today");
                let line = lines[card.line];
                line = /^\\s*\\[\\w+\\]/.test(line) ? line.replace(/^(\\s*)\\[\\w+\\]/, `$1[${status}]`) : `[${status}] ${line.trim()}`;
                if (["doing", "review", "done"].includes(status) && !/\\bstarted:\\d{4}-\\d{2}-\\d{2}/.test(line)) line += ` started:${today}`;
                if (status === "done" && !/\\bdone:\\d{4}-\\d{2}-\\d{2}/.test(line)) line += ` done:${today}`;
                if (status !== "done") line = line.replace(/\\s+done:\\d{4}-\\d{2}-\\d{2}/, "");
                lines[card.line] = line;
                card.status = status;   // show it at once; Python confirms with the next state
                draw();
                save(lines);
              };

              // Remove the task and its note lines.
              const remove = (card) => {
                const lines = model.get("text").split("\\n");
                lines.splice(card.line, 1 + card.note_lines);
                save(lines);
              };

              // Notes are the indented lines right below the task.
              const setNote = (card, note) => {
                const lines = model.get("text").split("\\n");
                const noteLines = note.split("\\n").map((line) => line.trimEnd()).filter((line) => line.trim()).map((line) => "    " + line.trim());
                lines.splice(card.line + 1, card.note_lines, ...noteLines);
                save(lines);
              };

              const add = (status, title) => {
                const lines = model.get("text").replace(/\\s+$/, "").split("\\n");
                lines.push(`[${status}] ${title}`);
                save(lines);
              };

              const cardElement = (card, index, columns) => {
                const item = h("article", `card ${card.priority}`);
                item.draggable = true;
                item.tabIndex = 0;
                item.addEventListener("dragstart", (event) => { dragged = card; event.dataTransfer.effectAllowed = "move"; item.classList.add("dragging"); });
                item.addEventListener("dragend", () => item.classList.remove("dragging"));
                const title = h("div", "title", (card.area === "life" ? "🏠 " : "") + card.title);
                const meta = h("div", "meta");
                const parts = [];
                if (card.project) parts.push(h("span", "", "#" + card.project));
                if (card.due && card.status !== "done") {
                  const date = new Date(card.due + "T00:00").toLocaleDateString("en", { month: "short", day: "2-digit" });
                  parts.push(h("span", card.late ? "late" : "", (card.late ? "⏰ " : "") + date));
                }
                if (card.estimate) parts.push(h("span", "", `${card.estimate} h`));
                parts.forEach((part, index) => { if (index) meta.append(" · "); meta.append(part); });
                const actions = h("div", "actions");
                let editor = null;
                const noteButton = h("button", "", "📝");
                noteButton.setAttribute("aria-label", `Notes for “${card.title}”`);
                noteButton.title = "Notes";
                noteButton.addEventListener("click", () => {
                  if (editor) { editor.remove(); editor = null; return; }
                  editor = h("div", "note-editor");
                  const area = h("textarea");
                  area.value = card.note || "";
                  area.rows = 4;
                  area.placeholder = "Notes, links, next steps…";
                  const buttons = h("div", "note-buttons");
                  const saveButton = h("button", "primary", "Save");
                  saveButton.addEventListener("click", () => setNote(card, area.value));
                  const cancel = h("button", "", "Cancel");
                  cancel.addEventListener("click", () => { editor.remove(); editor = null; });
                  buttons.append(cancel, saveButton);
                  editor.append(area, buttons);
                  item.append(editor);
                  item.draggable = false;   // so text can be selected in the editor
                  area.focus();
                });
                const deleteButton = h("button", "", "🗑");
                deleteButton.setAttribute("aria-label", `Delete “${card.title}”`);
                deleteButton.title = "Delete";
                let armed = null;
                deleteButton.addEventListener("click", () => {
                  if (armed) { clearTimeout(armed); remove(card); return; }
                  deleteButton.textContent = "Delete?";
                  deleteButton.classList.add("danger");
                  armed = setTimeout(() => { armed = null; deleteButton.textContent = "🗑"; deleteButton.classList.remove("danger"); }, 3000);
                });
                const step = (offset, symbol) => {
                  const target = columns[index + offset];
                  const button = h("button", "", symbol);
                  button.disabled = !target;
                  if (target) {
                    button.setAttribute("aria-label", `Move “${card.title}” to ${target[0]}`);
                    button.addEventListener("click", () => move(card, target[1]));
                  }
                  return button;
                };
                const middle = h("div", "middle");
                middle.append(noteButton, deleteButton);
                actions.append(step(-1, "‹"), middle, step(1, "›"));
                item.append(title, meta);
                if (card.note) item.append(h("div", "note", card.note.split("\\n")[0]));
                item.append(actions);
                return item;
              };

              const draw = () => {
                const columns = model.get("columns");
                const cards = model.get("cards");
                const wip = model.get("wip");
                const shownDone = model.get("done_shown");
                board.replaceChildren();
                columns.forEach(([label, status], index) => {
                  let mine = cards.filter((card) => card.status === status);
                  const total = mine.length;
                  if (status === "done") mine = [...mine].sort((a, b) => (b.done || "").localeCompare(a.done || "")).slice(0, shownDone);
                  else mine = [...mine].sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || (a.due || "9999").localeCompare(b.due || "9999"));
                  const limit = wip[label];
                  const lane = h("section", `lane ${status}` + (limit !== undefined && total > limit ? " over" : ""));
                  const header = h("header");
                  header.append(h("span", "", label), h("span", "count", limit !== undefined ? `${total}/${limit}` : String(total)));
                  lane.append(header);
                  for (const card of mine) lane.append(cardElement(card, index, columns));
                  if (total > mine.length) lane.append(h("div", "more", `+ ${total - mine.length} more`));
                  if (status === "backlog" || status === "todo") {
                    const input = h("input", "add");
                    input.placeholder = "+ Add a task";
                    input.setAttribute("aria-label", `Add a task to ${label}`);
                    input.addEventListener("keydown", (event) => {
                      if (event.key === "Enter" && input.value.trim()) { add(status, input.value.trim()); input.value = ""; }
                    });
                    lane.append(input);
                  }
                  lane.addEventListener("dragover", (event) => { event.preventDefault(); lane.classList.add("target"); });
                  lane.addEventListener("dragleave", () => lane.classList.remove("target"));
                  lane.addEventListener("drop", (event) => { event.preventDefault(); lane.classList.remove("target"); if (dragged) move(dragged, status); dragged = null; });
                  board.append(lane);
                });
              };

              for (const name of ["cards", "columns", "wip", "done_shown"]) model.on(`change:${name}`, draw);
              draw();
            }
            export default { render };
            """

            _css = """
            :host, .board { color-scheme: light dark; }
            .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(122px, 1fr)); gap: 10px; padding: 2px;
              font: 13px/1.35 system-ui, sans-serif; color: light-dark(#20231f, #e3e6de); }
            .lane { display: flex; flex-direction: column; gap: 7px; padding: 8px; border-radius: 10px;
              border-top: 4px solid var(--lane); background: light-dark(#f4f5f2, #1c1d1b); min-height: 80px; }
            .lane.target { outline: 2px dashed var(--lane); outline-offset: -2px; }
            .lane.backlog { --lane: #9aa3ad; } .lane.todo { --lane: #4b86d1; } .lane.doing { --lane: #e39b1b; }
            .lane.review { --lane: #8a63d2; } .lane.done { --lane: #36a269; }
            header { display: flex; justify-content: space-between; align-items: center; color: light-dark(#4e554b, #b9bdb5);
              font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
            .count { padding: 1px 8px; border-radius: 999px; background: light-dark(#fff, #2a2c28); }
            .lane.over { box-shadow: inset 0 0 0 2px #d6454566; }
            .lane.over .count { color: #fff; background: #d64545; }
            .card { position: relative; padding: 7px 9px 7px 9px; border-left: 4px solid var(--priority); border-radius: 7px; cursor: grab;
              background: light-dark(#fff, #262825); box-shadow: 0 1px 2px light-dark(#0000001f, #00000080); }
            .card.dragging { opacity: .4; }
            .card:focus-visible { outline: 2px solid #7157d9; }
            .card.high { --priority: #d64545; } .card.med { --priority: #e0a100; } .card.low { --priority: #3f9b5a; }
            .title { font-weight: 600; font-size: 12.5px; hyphens: auto; overflow-wrap: break-word; padding-right: 2px; }
            .meta { margin-top: 3px; color: light-dark(#687064, #9da397); font-size: 11.5px; }
            .meta .late { color: #d64545; font-weight: 700; }
            .actions { display: flex; justify-content: space-between; margin-top: 4px; opacity: 0; transition: opacity .15s; }
            .card:hover .actions, .card:focus-within .actions { opacity: 1; }
            @media (hover: none) { .actions { opacity: 1; } }
            .actions button { width: 26px; height: 22px; border: 1px solid light-dark(#cfd6c8, #3a3f36); border-radius: 6px;
              background: light-dark(#fff, #1b1e18); color: inherit; font: inherit; cursor: pointer; }
            .actions button:disabled { visibility: hidden; }
            .lane.done .card { opacity: .75; }
            .more { color: light-dark(#7a8176, #8d948a); font-size: 12px; text-align: center; }
            .middle { display: flex; gap: 4px; }
            .actions .middle button { width: auto; min-width: 26px; padding: 0 6px; font-size: 11px; }
            .actions button.danger { color: #fff; background: #d64545; border-color: #d64545; }
            .note { margin-top: 4px; color: light-dark(#5d6459, #a6ada4); font-size: 11.5px; font-style: italic;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .note::before { content: "📝 "; font-style: normal; }
            .note-editor { display: grid; gap: 6px; margin-top: 6px; }
            .note-editor textarea { box-sizing: border-box; width: 100%; padding: 6px; border: 1px solid light-dark(#cfd6c8, #3a3f36);
              border-radius: 6px; background: light-dark(#fbfcfa, #141513); color: inherit; font: 12px/1.4 system-ui, sans-serif; resize: vertical; }
            .note-buttons { display: flex; justify-content: flex-end; gap: 6px; }
            .note-buttons button { padding: 3px 10px; border: 1px solid light-dark(#cfd6c8, #3a3f36); border-radius: 6px;
              background: light-dark(#fff, #1b1e18); color: inherit; font: inherit; cursor: pointer; }
            .note-buttons .primary { color: #fff; background: #4b86d1; border-color: #4b86d1; }
            .add { padding: 6px 8px; border: 1px dashed light-dark(#cfd6c8, #3a3f36); border-radius: 7px; background: transparent;
              color: inherit; font: inherit; }
            """

            text = traitlets.Unicode("").tag(sync=True)
            cards = traitlets.List([]).tag(sync=True)
            columns = traitlets.List([]).tag(sync=True)
            wip = traitlets.Dict({}).tag(sync=True)
            today = traitlets.Unicode("").tag(sync=True)
            done_shown = traitlets.Int(5).tag(sync=True)

        return KanbanBoard

    # finished cards shown on the board (the rest stay in the statistics)
    done_shown = cell(
        "A6",
        field(5),
        label="done_shown",
        view={"widget": {"type": "range", "min": 0, "max": 20, "step": 1}},
    )

    @cell("B6", label="columns")
    @computed
    def columns(self):
        return {column: [task for task in self.tasks() if task['status'] == status] for column, status in self.board_columns().items()}

    # the look of the board, focus list, matrix, and habit tracker (CSS)
    board_css = cell(
        "A7",
        field(
            '.board { display: grid; grid-template-columns: repeat(auto-fit, minmax(122px, 1fr)); gap: 10px;\n  font: 13px/1.35 system-ui, sans-serif; }\n.lane { display: flex; flex-direction: column; gap: 7px; padding: 8px; border-radius: 10px;\n  border-top: 4px solid var(--lane); background: light-dark(#f4f5f2, #1c1d1b); }\n.lane.backlog { --lane: #9aa3ad; } .lane.todo { --lane: #4b86d1; } .lane.doing { --lane: #e39b1b; }\n.lane.review { --lane: #8a63d2; } .lane.done { --lane: #36a269; }\n.lane header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;\n  color: light-dark(#4e554b, #b9bdb5); font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }\n.count { padding: 1px 8px; border-radius: 999px; background: light-dark(#fff, #2a2c28); font-weight: 700; }\n.lane.over { box-shadow: inset 0 0 0 2px #d6454566; }\n.lane.over .count { color: #fff; background: #d64545; }\n.card { padding: 7px 9px; border-left: 4px solid var(--priority); border-radius: 7px;\n  background: light-dark(#fff, #262825); box-shadow: 0 1px 2px light-dark(#0000001f, #00000080); }\n.card.high { --priority: #d64545; } .card.med { --priority: #e0a100; } .card.low { --priority: #3f9b5a; }\n.title { font-weight: 600; font-size: 12.5px; hyphens: auto; overflow-wrap: break-word; }\n.meta { margin-top: 3px; color: light-dark(#687064, #9da397); font-size: 11.5px; }\n.late { color: #d64545; font-weight: 700; }\n.lane.done .card { opacity: .72; }\n.more, .empty { color: light-dark(#7a8176, #8d948a); font-size: 12px; text-align: center; }\n.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; font: 13px system-ui, sans-serif; }\n.kpi { padding: 10px 12px; border-radius: 10px; background: light-dark(#f4f5f2, #1c1d1b); }\n.kpi b { display: block; font-size: 24px; line-height: 1.1; }\n.kpi span { color: light-dark(#687064, #9da397); font-size: 12px; }\n.kpi.warn b { color: #d64545; }\n.focus { display: grid; gap: 8px; font: 13px/1.4 system-ui, sans-serif; }\n.focus .card { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 10px; }\n.rank { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: #fff;\n  background: var(--priority); font-weight: 800; }\n.why { color: light-dark(#687064, #9da397); font-size: 12px; }\n.estimate { color: light-dark(#4e554b, #b9bdb5); font-weight: 700; white-space: nowrap; }\n.matrix { display: grid; grid-template-columns: auto 1fr 1fr; grid-template-rows: auto 1fr 1fr; gap: 8px;\n  font: 13px/1.35 system-ui, sans-serif; }\n.axis { align-self: center; justify-self: center; color: light-dark(#687064, #9da397); font-size: 11px;\n  font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }\n.axis.side { writing-mode: vertical-rl; transform: rotate(180deg); }\n.quadrant { min-height: 110px; padding: 10px; border-radius: 10px; background: var(--tint); }\n.quadrant h4 { margin: 0 0 2px; font-size: 14px; }\n.quadrant p { margin: 0 0 8px; color: light-dark(#5d6459, #a6ada4); font-size: 12px; }\n.quadrant.do { --tint: light-dark(#fde8e8, #3a1f1f); } .quadrant.schedule { --tint: light-dark(#e6effb, #1c2a3d); }\n.quadrant.delegate { --tint: light-dark(#fff3dd, #3a2f19); } .quadrant.drop { --tint: light-dark(#eef0f3, #26282b); }\n.chip { display: inline-block; margin: 0 4px 4px 0; padding: 3px 8px; border-radius: 999px;\n  background: light-dark(#ffffffcc, #00000040); font-size: 12px; }\n.habits { width: 100%; border-collapse: collapse; font: 13px system-ui, sans-serif; }\n.habits td { padding: 6px 4px; border-bottom: 1px solid light-dark(#e8ebe4, #2a2c28); }\n.days { display: flex; gap: 3px; }\n.day { width: 13px; height: 13px; border-radius: 3px; background: light-dark(#e3e6de, #33362f); }\n.day.on { background: #36a269; }\n.day.week { outline: 1px solid light-dark(#9aa3ad, #6b7178); outline-offset: 1px; }\n.ok { color: #36a269; font-weight: 700; } .todo-left { color: #e0a100; font-weight: 700; }'
        ),
        label="board_css",
    )

    @cell("B7", label="wip_breaches")
    @computed
    def wip_breaches(self):
        breaches = []
        for column, limit in self.wip_limits().items():
            count = len(self.columns().get(column, []))
            if count > limit:
                breaches.append(f'{column} has {count} cards (limit {limit})')
        return breaches

    @cell("B8", label="wip_text")
    @computed
    def wip_text(self):
        return '✅ Work in progress is within the limits.' if not self.wip_breaches() else '⚠️ ' + '; '.join(self.wip_breaches()) + ': finish or move cards back before starting new ones.'

    @cell("B9", label="syntax_problems")
    @computed
    def syntax_problems(self):
        unknown = sorted({task['status'] for task in self.all_tasks()} - set(self.board_columns().values()))
        return '' if not unknown else 'Unknown status: ' + ', '.join(unknown) + ' (use ' + ', '.join(self.board_columns().values()) + ').'

    @cell("B10", label="board_cards")
    @computed
    def board_cards(self):
        # the cards the board shows (filtered by area), as plain values for the widget
        return [{'line': task['line'], 'title': task['title'], 'status': task['status'], 'priority': task['priority'],
          'area': task['area'], 'project': task['project'], 'estimate': task['estimate'],
          'note': task['note'], 'note_lines': task['note_lines'],
          'due': task['due'].isoformat() if task['due'] else None,
          'done': task['done'].isoformat() if task['done'] else None,
          'late': bool(task['due'] and task['due'] < self.today())} for task in self.tasks()]

    @cell("C13", label="kpis", view={"display": "rendered", "span": [5, 2]})
    @computed
    def kpis(self):
        import datetime as dt
        monday = self.today() - dt.timedelta(days=self.today().weekday())
        done_this_week = len([task for task in self.tasks() if task['status'] == 'done' and task['done'] and task['done'] >= monday])
        tiles = [
            (len(self.columns()['Doing']), 'in progress', bool(self.wip_breaches())),
            (len(self.columns()['To do']), 'ready to start', False),
            (len(self.workbook.Priorities.overdue()), 'overdue', len(self.workbook.Priorities.overdue()) > 0),
            (done_this_week, 'done this week', False),
            (f'{self.workbook.Planning.load_percent()} %', 'of the week planned', self.workbook.Planning.load_percent() > 100),
        ]
        cells = ''.join(f"<div class='kpi{' warn' if warn else ''}'><b>{value}</b><span>{label}</span></div>" for value, label, warn in tiles)
        return html(f"<style>{self.board_css()}</style><div class='kpis'>{cells}</div>")


class PrioritiesWorksheet(Worksheet["ProjectPlannerWorkbook"]):
    # a task due within this many days is urgent
    urgent_days = cell(
        "A1",
        field(3),
        label="urgent_days",
        view={"widget": {"type": "range", "min": 0, "max": 14, "step": 1}},
    )

    @cell("B1", label="open_tasks")
    @computed
    def open_tasks(self):
        return [task for task in self.workbook.Board.tasks() if task['status'] != 'done']

    @cell("C1", label="eisenhower", view={"display": "rendered", "span": [4, 8]})
    @computed
    def eisenhower(self):
        from html import escape
        boxes = {
            'Do first': ('do', 'Do it today.'),
            'Schedule': ('schedule', 'Put it in the calendar: this is where progress happens.'),
            'Delegate': ('delegate', 'Hand it off, automate it, or batch it.'),
            'Drop': ('drop', 'Delete it or park it in the backlog.'),
        }
        def box(name):
            kind, action = boxes[name]
            chips = ''.join(f"<span class='chip'>{escape(task['title'])}</span>" for task in self.quadrants()[name]) or '—'
            return f"<div class='quadrant {kind}'><h4>{name} · {len(self.quadrants()[name])}</h4><p>{action}</p>{chips}</div>"
        return html(f"<style>{self.workbook.Board.board_css()}</style><div class='matrix'>"
             "<span></span><span class='axis'>Urgent</span><span class='axis'>Not urgent</span>"
             f"<span class='axis side'>Important</span>{box('Do first')}{box('Schedule')}"
             f"<span class='axis side'>Not important</span>{box('Delegate')}{box('Drop')}</div>")

    @cell("G1", label="priorities_note")
    @markdown
    def priorities_note(self):
        return """# Prioritise: the Eisenhower matrix and a daily top 3

        > "What is important is seldom urgent and what is urgent is seldom important."
        > — attributed to Dwight D. Eisenhower

        ## The matrix

        Sort every open task by two questions: **Is it important** (does it move a goal forward)?
        **Is it urgent** (due within {{ self.urgent_days() }} days, or overdue)?

        [Urgent means due within (days): {{ self.urgent_days() }}](#sheet-input:urgent_days?type=range&min=0&max=14&step=1)

        {{ self.eisenhower() }}

        Here *important* means high or medium priority. **{{ len(self.quadrants()['Do first']) }}** tasks need you today,
        **{{ len(self.quadrants()['Schedule']) }}** deserve a slot in your calendar.

        ### How to use each quadrant

        - **Do first** should be small. If it is always full, you are fire-fighting: things become
          urgent because they were not scheduled when they were merely important.
        - **Schedule** is where careers, health and relationships are built. Protect time for it
          *before* the week fills up.
        - **Delegate** feels important because it is loud. Ask: does it need *me*?
        - **Drop** — the most underused quadrant. Deleting a task is a decision, not a failure.

        ## Your focus for today

        {{ self.focus_list() }}

        [Tasks per day: {{ self.focus_count() }}](#sheet-input:focus_count?type=range&min=1&max=6&step=1)

        The list ranks tasks by priority, urgency, and whether you already started them (finishing
        beats starting). It follows the **Ivy Lee method** (1918):

        1. At the end of each day, write down the most important tasks for tomorrow — no more than six.
        2. Order them by importance.
        3. Tomorrow, work on the first until it is finished, then the second.
        4. Move unfinished tasks to the next day's list.

        ## Best practices

        - **Eat the frog:** do the hardest important task first, while your energy is highest.
        - **MoSCoW** for scope: label features or wishes *Must*, *Should*, *Could*, *Won't (this time)*.
          If everything is a Must, nothing is.
        - **Priority is relative.** If more than a third of your tasks are high priority, re-rank.
        - **Deadlines are not priorities.** A due date says *when*, not *whether*. Ask whether the
          task matters at all before asking when.
        - **Say no** (or "not now") to protect the Schedule quadrant.

        ---

        **Previous:** [How Kanban works](#note-kanban_note) · **Next:** [Plan your week](#note-planning_note)"""

    # points per priority for the daily focus list
    priority_points = cell(
        "A2", field({'high': 3, 'med': 2, 'low': 1}), label="priority_points"
    )

    @cell("B2", label="overdue")
    @computed
    def overdue(self):
        return [task for task in self.open_tasks() if task['due'] and task['due'] < self.workbook.Board.today()]

    # how many tasks to focus on each day (Ivy Lee: at most 6; most people do best with 3)
    focus_count = cell(
        "A3",
        field(3),
        label="focus_count",
        view={"widget": {"type": "range", "min": 1, "max": 6, "step": 1}},
    )

    @cell("B3", label="is_urgent")
    @computed
    def is_urgent(self):
        def is_urgent(task):
            """Overdue or due within the urgent window."""
            return task['due'] is not None and (task['due'] - self.workbook.Board.today()).days <= self.urgent_days()

        return is_urgent

    @cell("B4", label="quadrants")
    @computed
    def quadrants(self):
        quadrants = {'Do first': [], 'Schedule': [], 'Delegate': [], 'Drop': []}
        for task in self.open_tasks():
            important = task['priority'] in ('high', 'med')
            urgent = self.is_urgent()(task)
            key = ('Do first' if urgent else 'Schedule') if important else ('Delegate' if urgent else 'Drop')
            quadrants[key].append(task)
        return quadrants

    @cell("B6", label="focus_score")
    @computed
    def focus_score(self):
        def focus_score(task):
            """Priority points, plus urgency, plus a bonus for finishing what is started."""
            score = self.priority_points()[task['priority']] * 2
            if task['due'] is not None:
                days = (task['due'] - self.workbook.Board.today()).days
                score += 4 if days < 0 else 3 if days <= 1 else 2 if days <= self.urgent_days() else 0
            if task['status'] in ('doing', 'review'):
                score += 2
            return score

        return focus_score

    @cell("B7", label="focus_tasks")
    @computed
    def focus_tasks(self):
        candidates = [task for task in self.open_tasks() if task['status'] in ('todo', 'doing', 'review')]
        return sorted(candidates, key=lambda task: (-self.focus_score()(task), task['estimate'] or 99))[:self.focus_count()]

    @cell("C9", label="focus_list", view={"display": "rendered", "span": [4, 5]})
    @computed
    def focus_list(self):
        from html import escape
        rows = []
        for index, task in enumerate(self.focus_tasks()):
            why = ', '.join(filter(None, [
                'overdue' if task['due'] and task['due'] < self.workbook.Board.today() else ('due soon' if self.is_urgent()(task) else ''),
                'already started' if task['status'] in ('doing', 'review') else '',
                f"{task['priority']} priority"]))
            estimate = f"{task['estimate']:g} h" if task['estimate'] else ''
            rows.append(f"<article class='card {task['priority']}'><span class='rank'>{index + 1}</span>"
                        f"<div><div class='title'>{escape(task['title'])}</div><div class='why'>{why}</div></div>"
                        f"<span class='estimate'>{estimate}</span></article>")
        return html(f"<style>{self.workbook.Board.board_css()}</style><div class='focus'>{''.join(rows) or 'Nothing committed: pick tasks from the backlog.'}</div>")


class PlanningWorksheet(Worksheet["ProjectPlannerWorkbook"]):
    # focused hours you can plan per day
    hours_per_day = cell(
        "A1",
        field(6),
        label="hours_per_day",
        view={"widget": {"type": "range", "min": 1, "max": 12, "step": 0.5}},
    )

    @cell("B1", label="capacity_hours")
    @computed
    def capacity_hours(self):
        return round(self.hours_per_day() * self.days_per_week() * self.focus_factor(), 1)

    @cell("C1", label="throughput_chart", view={"display": "rendered", "span": [4, 8]})
    @computed
    def throughput_chart(self):
        import plotly.graph_objects as go
        colors = ['#c4cbd3' if current else '#4b86d1' for current in self.throughput()['Current week']]
        figure = go.Figure(go.Bar(x=self.throughput()['Week of'], y=self.throughput()['Finished'], marker_color=colors,
                                  text=self.throughput()['Finished'], textposition='outside', name='Finished'))
        figure.add_hline(y=self.avg_throughput(), line_dash='dash', line_color='#36a269',
                         annotation_text=f'average {self.avg_throughput()} per week')
        figure.update_layout(title=dict(text='Tasks finished per week', x=0, font=dict(size=15)),
                             template='plotly_white', height=320, margin=dict(l=40, r=16, t=56, b=40),
                             yaxis_title='tasks', showlegend=False)
        return figure

    @cell("G1", label="planning_note")
    @markdown
    def planning_note(self):
        return """# Plan your week: capacity and forecasts

        ## Capacity: what fits into a week

        A day has 24 hours; a working day has far fewer **focused** hours. Meetings, email and
        interruptions take their share.

        [Focused hours per day: {{ self.hours_per_day() }}](#sheet-input:hours_per_day?type=range&min=1&max=12&step=0.5)

        [Days per week: {{ self.days_per_week() }}](#sheet-input:days_per_week?type=range&min=1&max=7&step=1)

        [Share left after meetings and interruptions: {{ self.focus_factor() }}](#sheet-input:focus_factor?type=range&min=0.3&max=1&step=0.05)

        $$\\text{capacity} = {{ self.hours_per_day() }}\\ \\text{h} \\times {{ self.days_per_week() }} \\times {{ self.focus_factor() }} = {{ self.capacity_hours() }}\\ \\text{h per week}$$

        Your committed tasks (To do, Doing, Review) add up to **{{ self.committed_hours() }} h** — that is
        **{{ self.load_percent() }} %** of one week{{ '. You are overcommitted: move cards back to the backlog or renegotiate dates.' if self.load_percent() > 100 else '. That leaves room for the unexpected.' if self.load_percent() <= 80 else '. Tight: keep a buffer for the unexpected.' }}

        > Plan to about **80 %**. The planning fallacy is real: we underestimate tasks by 30–50 %
        > on average, even when we know we do.

        ## Throughput: what you actually finish

        {{ self.throughput_chart() }}

        On average you finish **{{ self.avg_throughput() }} tasks a week** (last {{ self.history_weeks() }} complete weeks; the grey bar
        is this week so far). Throughput comes from your `done:` dates — no estimates needed.

        ## Forecast: when will it be done?

        {{ self.remaining_count() }} committed tasks ÷ {{ self.avg_throughput() }} per week ≈ **{{ self.forecast_text() }}**.

        Counting finished tasks is often a *better* forecast than adding up estimates: it already
        includes interruptions, meetings and optimism. Keep cards roughly the same size and the
        forecast gets better every week.

        ## Cycle time and Little's Law

        A finished task took on average **{{ self.avg_cycle_time() }} days** from `started:` to `done:`. Right now
        {{ self.wip_now() }} cards are in progress, which by Little's Law means about **{{ self.littles_law_days() }} days** per card{{ ' — far more than the ' + str(self.avg_cycle_time()) + ' days you are used to. Too many cards are open at once: finish before starting.' if self.littles_law_days() and self.avg_cycle_time() and (self.littles_law_days() > 1.5 * self.avg_cycle_time()) else '.' }}

        {{ self.aging_text() }}

        ## Techniques that help

        - **Time blocking:** give your top tasks a fixed slot in the calendar, like a meeting with
          yourself. Block the *Schedule* quadrant first.
        - **Pomodoro:** work {{ self.pomodoro_minutes() }} minutes, pause 5; after four, pause longer. Your committed work is
          about **{{ self.pomodoros() }} pomodoros**.
        - **Batch the small stuff:** email, calls and admin in one or two blocks a day.
        - **Buffer:** leave 20 % of the week unplanned. Something always comes up.
        - **Estimate in ranges** for big work ("2–4 days") and track how long tasks really take.

        ---

        **Previous:** [Prioritise](#note-priorities_note) · **Next:** [Goals and habits](#note-goals_note)"""

    # working days per week
    days_per_week = cell(
        "A2",
        field(5),
        label="days_per_week",
        view={"widget": {"type": "range", "min": 1, "max": 7, "step": 1}},
    )

    @cell("B2", label="committed_hours")
    @computed
    def committed_hours(self):
        committed = [task for task in self.workbook.Board.tasks() if task['status'] in ('todo', 'doing', 'review')]
        return round(sum(task['estimate'] or self.default_estimate() for task in committed), 1)

    # share of time left after meetings, email and interruptions
    focus_factor = cell(
        "A3",
        field(0.7),
        label="focus_factor",
        view={"widget": {"type": "range", "min": 0.3, "max": 1, "step": 0.05}},
    )

    @cell("B3", label="load_percent")
    @computed
    def load_percent(self):
        return round(100 * self.committed_hours() / self.capacity_hours()) if self.capacity_hours() else 0

    # hours assumed for tasks without an estimate
    default_estimate = cell(
        "A4",
        field(1),
        label="default_estimate",
        view={"widget": {"type": "range", "min": 0.25, "max": 8, "step": 0.25}},
    )

    @cell("B4", label="throughput")
    @computed
    def throughput(self):
        import datetime as dt
        import pandas as pd
        monday = self.workbook.Board.today() - dt.timedelta(days=self.workbook.Board.today().weekday())
        weeks = [monday - dt.timedelta(weeks=offset) for offset in range(self.history_weeks(), -1, -1)]
        finished = [task for task in self.workbook.Board.tasks() if task['status'] == 'done' and task['done']]
        rows = []
        for start in weeks:
            end = start + dt.timedelta(days=7)
            week_tasks = [task for task in finished if start <= task['done'] < end]
            rows.append({'Week of': start.isoformat(), 'Finished': len(week_tasks),
                         'Hours': sum(task['estimate'] or self.default_estimate() for task in week_tasks),
                         'Current week': start == monday})
        return pd.DataFrame(rows)

    # weeks of history for throughput
    history_weeks = cell(
        "A5",
        field(4),
        label="history_weeks",
        view={"widget": {"type": "range", "min": 2, "max": 12, "step": 1}},
    )

    @cell("B5", label="avg_throughput")
    @computed
    def avg_throughput(self):
        # completed weeks only: the current week is not over yet
        complete = self.throughput()[~self.throughput()['Current week']]
        return round(complete['Finished'].mean(), 1) if len(complete) else 0

    # minutes of one pomodoro
    pomodoro_minutes = cell(
        "A6",
        field(25),
        label="pomodoro_minutes",
        view={"widget": {"type": "range", "min": 15, "max": 60, "step": 5}},
    )

    @cell("B6", label="remaining_count")
    @computed
    def remaining_count(self):
        return len([task for task in self.workbook.Board.tasks() if task['status'] in ('todo', 'doing', 'review')])

    @cell("B7", label="forecast_text")
    @computed
    def forecast_text(self):
        import datetime as dt
        if self.avg_throughput() <= 0:
            text = 'no finished tasks yet: add done: dates to forecast'
        else:
            weeks = self.remaining_count() / self.avg_throughput()
            text = f'about {weeks:.1f} weeks (around {self.workbook.Board.today() + dt.timedelta(weeks=weeks):%d %B})'
        return text

    @cell("B8", label="cycle_times")
    @computed
    def cycle_times(self):
        days = [(task['done'] - task['started']).days + 1 for task in self.workbook.Board.tasks()
                if task['status'] == 'done' and task['done'] and task['started']]
        return days

    @cell("B9", label="avg_cycle_time")
    @computed
    def avg_cycle_time(self):
        return round(sum(self.cycle_times()) / len(self.cycle_times()), 1) if self.cycle_times() else None

    @cell("B10", label="wip_now")
    @computed
    def wip_now(self):
        return len([task for task in self.workbook.Board.tasks() if task['status'] in ('doing', 'review')])

    @cell("B11", label="littles_law_days")
    @computed
    def littles_law_days(self):
        # Little's Law: cycle time = WIP / throughput (in days)
        return round(self.wip_now() / self.avg_throughput() * 7, 1) if self.avg_throughput() else None

    @cell("B12", label="pomodoros")
    @computed
    def pomodoros(self):
        import math
        return math.ceil(self.committed_hours() * 60 / self.pomodoro_minutes())

    @cell("B13", label="aging_text")
    @computed
    def aging_text(self):
        aging = []
        for task in self.workbook.Board.tasks():
            if task['status'] in ('doing', 'review') and task['started']:
                age = (self.workbook.Board.today() - task['started']).days
                if self.avg_cycle_time() and age > self.avg_cycle_time():
                    aging.append(f"{task['title']} ({age} days)")
        return 'Older than your average cycle time: ' + '; '.join(aging) + '. Finish, split, or unblock them.' if aging else 'No card is older than your average cycle time.'


class GoalsWorksheet(Worksheet["ProjectPlannerWorkbook"]):
    # objectives and key results
    okr_text = cell(
        "A1",
        field(
            '// O: objective  ·  KR: key result | start | current | target   (a target below the start means lower is better)\nO: Launch the new website successfully\nKR: Weekly sign-ups | 40 | 120 | 200\nKR: Checkout conversion (%) | 1.8 | 2.4 | 3.0\nKR: Page load time (s) | 3.5 | 2.6 | 2.0\nO: Get fitter this quarter\nKR: 10 km run time (min) | 62 | 57 | 55\nKR: Workouts per week | 1 | 3 | 4\nO: Build a financial cushion\nKR: Emergency fund (EUR) | 2000 | 4500 | 9000'
        ),
        label="okr_text",
        view={"widget": {"type": "textarea"}},
    )

    @cell("B1", label="key_results")
    @computed
    def key_results(self):
        rows, objective = [], ''
        for line in self.okr_text().splitlines():
            line = line.strip()
            if line.startswith('O:'):
                objective = line[2:].strip()
            elif line.startswith('KR:'):
                name, start, current, target = [part.strip() for part in line[3:].split('|')]
                start, current, target = float(start), float(current), float(target)
                progress = 0.0 if target == start else (current - start) / (target - start)
                rows.append({'objective': objective, 'key_result': name, 'start': start, 'current': current,
                             'target': target, 'progress': max(0.0, min(1.0, progress))})
        return rows

    @cell("C1", label="okr_chart", view={"display": "rendered", "span": [4, 8]})
    @computed
    def okr_chart(self):
        import plotly.graph_objects as go
        labels = [row['key_result'] for row in self.key_results()]
        values = [round(100 * row['progress']) for row in self.key_results()]
        colors = ['#36a269' if value >= 70 else '#f5a623' if value >= 40 else '#d65a5a' for value in values]
        figure = go.Figure(go.Bar(x=values, y=labels, orientation='h', marker_color=colors,
                                  text=[f'{value} %' for value in values], textposition='auto'))
        figure.add_vline(x=70, line_dash='dash', line_color='#9aa3ad', annotation_text='0.7 = a good result')
        figure.update_layout(title=dict(text='Key results', x=0, font=dict(size=15)), template='plotly_white',
                             height=340, margin=dict(l=40, r=16, t=56, b=40), xaxis=dict(range=[0, 100], title='% of the way'))
        figure.update_yaxes(autorange='reversed')
        return figure

    @cell("G1", label="goals_note")
    @markdown
    def goals_note(self):
        return """# Goals and habits

        Tasks are *what* you do; goals say *why*; habits make it happen without willpower.

        ## OKRs: objectives and key results

        An **objective** is a qualitative, inspiring direction ("Get fitter this quarter").
        **Key results** are 2–4 measurable outcomes that prove you got there ("10 km in 55 min").
        Intel introduced OKRs in the 1970s; Google made them famous.

        {{ self.okr_chart() }}

        {{ self.okr_table() }}

        {{ '; '.join((f'**{name}**: {value} %' for name, value in self.objective_progress().items())) }}.

        [Objectives and key results: {{ self.okr_text() }}](#sheet-input:okr_text?type=textarea)

        ### Writing good OKRs

        - **Outcomes, not tasks.** "Weekly sign-ups 40 → 200" is a key result; "Write five blog
          posts" is a task that might get you there (put it on the board).
        - **Ambitious on purpose.** Reaching about **70 %** is a good result; 100 % every time means
          the goals were too safe.
        - **Few.** 1–3 objectives per quarter, 2–4 key results each.
        - **Check weekly, grade at the end of the quarter,** and link board tasks to key results with a
          project tag (`#launch`).
        - For personal goals, **SMART** works too: Specific, Measurable, Achievable, Relevant,
          Time-bound.

        ## Habits

        {{ self.habit_tracker() }}

        [Habits: {{ self.habit_text() }}](#sheet-input:habit_text?type=textarea)

        **Click a day to tick it.** *Start a new day* moves the 14-day window on by one. The outlined squares are the last seven days. The tracker writes the habit list below, which you can also edit directly.

        ### Building habits that stick

        - **Make it tiny.** Two pages, one push-up, one minute of meditation. Grow it once it is
          automatic (on average after about two months, with large differences between people).
        - **Habit stacking:** "After I pour my coffee, I read 10 pages." Attach new habits to
          existing ones.
        - **Never miss twice.** A missed day is normal; two in a row starts a new habit — of skipping.
          The weekly target allows for imperfect weeks.
        - **Design the environment:** the book on the pillow, the phone charging outside the bedroom.
        - **Track visibly.** Seeing the streak is a reward in itself.

        ---

        **Previous:** [Plan your week](#note-planning_note) · **Next:** [Weekly review](#note-review_note)"""

    # habits: the last 14 days and the weekly target
    habit_text = cell(
        "A2",
        field(
            '// Habit | the last 14 days, oldest first (1 = done, 0 = missed) | target days per week\nExercise 30 min | 10110110101101 | 4\nRead 20 pages | 11111011111110 | 6\nNo phone after 22:00 | 00110111011111 | 5\nMeditate 10 min | 10010001010011 | 5'
        ),
        label="habit_text",
        view={"widget": {"type": "textarea"}},
    )

    @cell("B2", label="objective_progress")
    @computed
    def objective_progress(self):
        objectives = {}
        for row in self.key_results():
            objectives.setdefault(row['objective'], []).append(row['progress'])
        return {name: round(100 * sum(values) / len(values)) for name, values in objectives.items()}

    @cell("B3", label="habits")
    @computed
    def habits(self):
        habits = []
        for number, line in enumerate(self.habit_text().splitlines()):
            if not line.strip() or line.strip().startswith('//'):
                continue
            name, days, target = [part.strip() for part in line.split('|')]
            days = [character == '1' for character in days if character in '01']
            streak = 0
            for done in reversed(days):
                if not done:
                    break
                streak += 1
            best = current = 0
            for done in days:
                current = current + 1 if done else 0
                best = max(best, current)
            habits.append({'line': number, 'name': name, 'days': days, 'target': int(target), 'last7': sum(days[-7:]),
                           'streak': streak, 'best': best})
        return habits

    @cell("B4", label="HabitTracker")
    @computed
    def HabitTracker(self):
        import anywidget
        import traitlets

        class HabitTracker(anywidget.AnyWidget):
            """Habit rows with the last 14 days: click a day to tick it, "Start a new day" moves the
            window on. Bind `text` to the habit list input cell."""

            _esm = """
            const h = (tag, className, text) => {
              const element = document.createElement(tag);
              if (className) element.className = className;
              if (text !== undefined) element.textContent = text;
              return element;
            };

            function render({ model, el }) {
              const root = h("div", "tracker");
              el.append(root);

              // Rewrite one line ("name | days | target") with new days.
              const update = (change) => {
                const lines = model.get("text").split("\\n");
                for (const habit of model.get("habits")) {
                  const [name, days, target] = lines[habit.line].split("|").map((part) => part.trim());
                  lines[habit.line] = `${name} | ${change(habit, days)} | ${target}`;
                }
                model.set("text", lines.join("\\n"));
                model.save_changes();
              };

              const draw = () => {
                root.replaceChildren();
                const table = h("table");
                for (const habit of model.get("habits")) {
                  const row = h("tr");
                  const days = h("div", "days");
                  habit.days.forEach((done, index) => {
                    const ago = habit.days.length - 1 - index;
                    const day = h("button", "day" + (done ? " on" : "") + (ago < 7 ? " week" : ""));
                    day.setAttribute("aria-pressed", String(done));
                    day.setAttribute("aria-label", `${habit.name}, ${ago === 0 ? "today" : ago === 1 ? "yesterday" : ago + " days ago"}`);
                    day.title = ago === 0 ? "today" : `${ago} day${ago === 1 ? "" : "s"} ago`;
                    day.addEventListener("click", () => update((other, text) =>
                      other.line !== habit.line ? text : text.slice(0, index) + (text[index] === "1" ? "0" : "1") + text.slice(index + 1)));
                    days.append(day);
                  });
                  const left = habit.target - habit.last7;
                  const cells = [
                    h("b", "", habit.name), days,
                    h("span", "", `${habit.last7}/${habit.target} this week`),
                    h("span", "", `🔥 ${habit.streak} day${habit.streak === 1 ? "" : "s"}`),
                    h("span", left <= 0 ? "ok" : "todo", left <= 0 ? "✓ on target" : `${left} to go`),
                  ];
                  for (const cell of cells) { const td = h("td"); td.append(cell); row.append(td); }
                  table.append(row);
                }
                const next = h("button", "next", "Start a new day →");
                next.title = "Drop the oldest day and add an empty one for today";
                next.addEventListener("click", () => update((habit, text) => text.slice(1) + "0"));
                root.append(table, next);
              };

              model.on("change:habits", draw);
              draw();
            }
            export default { render };
            """

            _css = """
            :host, .tracker { color-scheme: light dark; }
            .tracker { display: grid; gap: 10px; font: 13px system-ui, sans-serif; color: light-dark(#20231f, #e3e6de); }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 6px 4px; border-bottom: 1px solid light-dark(#e8ebe4, #2a2c28); white-space: nowrap; }
            .days { display: flex; gap: 3px; }
            .day { width: 15px; height: 15px; padding: 0; border: 0; border-radius: 3px; cursor: pointer;
              background: light-dark(#e3e6de, #33362f); }
            .day:hover { outline: 1px solid #36a269; }
            .day.on { background: #36a269; }
            .day.week { box-shadow: 0 0 0 1px light-dark(#9aa3ad, #6b7178); }
            .ok { color: #36a269; font-weight: 700; } .todo { color: #e0a100; font-weight: 700; }
            .next { justify-self: start; padding: 5px 12px; border: 1px solid light-dark(#cfd6c8, #3a3f36); border-radius: 7px;
              background: light-dark(#fff, #1b1e18); color: inherit; font: inherit; cursor: pointer; }
            """

            text = traitlets.Unicode("").tag(sync=True)
            habits = traitlets.List([]).tag(sync=True)

        return HabitTracker

    @cell("C9", label="okr_table", view={"display": "rendered", "span": [4, 8]})
    @computed
    def okr_table(self):
        import pandas as pd
        def status(progress):
            return '🟢 on track' if progress >= 0.7 else '🟡 at risk' if progress >= 0.4 else '🔴 behind'
        return pd.DataFrame([
            {'Objective': row['objective'], 'Key result': row['key_result'],
             'Now': f"{row['current']:g} of {row['target']:g}", 'Progress': f"{100 * row['progress']:.0f} %",
             'Status': status(row['progress'])}
            for row in self.key_results()
        ])

    @cell("C17", label="habit_tracker", view={"display": "rendered", "span": [4, 6]})
    @computed
    def habit_tracker(self):
        # click a day to tick it; the tracker writes habit_text (bind)
        return bind(self.HabitTracker()(habits=self.habits()), text=self.habit_text())


class ReviewWorksheet(Worksheet["ProjectPlannerWorkbook"]):
    # this week's review: tick the steps you finished
    review_done = cell(
        "A1",
        field(['Empty all inboxes', 'Clear your head', 'Review last week']),
        label="review_done",
        view={
            "widget": {
                "type": "multiselect",
                "options": [
                    "Empty all inboxes",
                    "Clear your head",
                    "Review last week",
                    "Look at the calendar",
                    "Update the board",
                    "Review projects",
                    "Check goals and habits",
                    "Scan the backlog",
                    "Pick next week's top 3",
                ],
            }
        },
    )

    @cell("B1", label="review_progress")
    @computed
    def review_progress(self):
        return round(100 * len(set(self.review_done()) & set(self.review_steps())) / len(self.review_steps()))

    @cell("C1", label="decision_table", view={"display": "rendered", "span": [4, 5]})
    @computed
    def decision_table(self):
        import pandas as pd
        criteria = self.decision()['criteria']
        total_weight = sum(weight for _, weight in criteria)
        rows = []
        for name, scores in self.decision()['options']:
            row = {'Option': name}
            for (criterion, weight), score in zip(criteria, scores):
                row[f'{criterion} (×{weight:g})'] = f'{score:g}'
            weighted = sum(weight * score for (_, weight), score in zip(criteria, scores))
            row['Score'] = round(100 * weighted / (5 * total_weight))
            rows.append(row)
        return pd.DataFrame(rows).sort_values('Score', ascending=False).reset_index(drop=True)

    @cell("G1", label="review_note")
    @markdown
    def review_note(self):
        return """# Weekly review

        The weekly review comes from David Allen's **Getting Things Done** (GTD). Once a week —
        Friday afternoon or Sunday evening — you step back from doing and make sure your system is
        complete and current. It is the habit that keeps every other tool in this workbook useful.

        ## This week: {{ self.review_progress() }} % done

        [Steps done: {{ self.review_done() }}](#sheet-input:review_done?type=multiselect&options=Empty%20all%20inboxes,Clear%20your%20head,Review%20last%20week,Look%20at%20the%20calendar,Update%20the%20board,Review%20projects,Check%20goals%20and%20habits,Scan%20the%20backlog,Pick%20next%20week's%20top%203)

        {{ '🎉 Review complete — enjoy your weekend.' if not self.review_left() else 'Still to do: ' + ', '.join(self.review_left()) + '.' }}

        ## The steps

        **Get clear**

        1. **Empty all inboxes** — email, messages, notes, the paper pile. Decide for each item:
           do it (under 2 minutes), put it on the board, or delete it.
        2. **Clear your head** — write down every open loop that is on your mind.

        **Get current**

        3. **Review last week** — what got done ({{ len(self.workbook.Board.columns()['Done']) }} cards so far), what slipped, and why?
        4. **Look at the calendar** — the past week for follow-ups, the next two weeks for preparation.
        5. **Update the board** — move cards, add `done:` dates, respect the WIP limits.
        6. **Review projects** — does every active project have a next action in *To do*?
        7. **Check goals and habits** — are this week's tasks moving a key result?

        **Get creative**

        8. **Scan the backlog** — promote, delete, or keep. A backlog that only grows is a guilt list.
        9. **Pick next week's top 3** — the outcomes that would make the week a success.

        ## A five-question retrospective

        Teams use retrospectives; they work just as well alone:

        - What went well, and how do I get more of it?
        - What was hard or annoying?
        - What did I learn?
        - What will I **try** differently next week (one thing)?
        - What am I grateful for?

        ## Best practices

        - **Same time, same place,** 30–60 minutes, calendar blocked.
        - **Review, don't redo:** the goal is a trusted system, not a perfect plan.
        - **Untick the steps** (or reset the list) at the start of each review.

        ---

        **Previous:** [Goals and habits](#note-goals_note) · **Next:** [Decide better](#note-decision_note)"""

    # all steps of the weekly review
    review_steps = cell(
        "A2",
        field(
            ['Empty all inboxes', 'Clear your head', 'Review last week', 'Look at the calendar', 'Update the board', 'Review projects', 'Check goals and habits', 'Scan the backlog', "Pick next week's top 3"]
        ),
        label="review_steps",
    )

    @cell("B2", label="review_left")
    @computed
    def review_left(self):
        return [step for step in self.review_steps() if step not in self.review_done()]

    @cell("G2", label="decision_note")
    @markdown
    def decision_note(self):
        return """# Decide better: the weighted decision matrix

        For decisions with several options and several things that matter — a job offer, a flat, a
        tool, a supplier — a **weighted decision matrix** makes the trade-offs visible.

        **{{ self.decision_verdict() }}**

        {{ self.decision_table() }}

        [Your decision: {{ self.decision_text() }}](#sheet-input:decision_text?type=textarea)

        ## How it works

        1. **List the options** — including "do nothing" or "keep the current one".
        2. **Choose 3–6 criteria** that matter, and give each a **weight** from 1 (nice to have) to 5
           (essential).
        3. **Score each option** on each criterion from 1 (poor) to 5 (excellent).
        4. Each option's score is the weighted sum, scaled to 100:

        $$\\text{score} = 100 \\cdot \\frac{\\sum_i w_i \\, s_i}{5 \\sum_i w_i}$$

        ## Best practices

        - **Set the weights before scoring** the options, or you will tune them towards the favourite.
        - **Score criteria one at a time across all options,** not one option at a time.
        - **Check the sensitivity:** change the weight of the most important criterion by one. If the
          winner changes, the decision is close — that is valuable to know.
        - **Listen to your gut reaction.** If the winner disappoints you, a criterion is missing.
          Add it and score again.
        - **Reversible or not?** Jeff Bezos' "two-way doors" (easy to undo) deserve quick decisions;
          "one-way doors" deserve this matrix and a night's sleep.

        ---

        **Previous:** [Weekly review](#note-review_note) · **Back to:** [Your board](#note-board_note)"""

    # a decision: criteria with weights, then options with scores
    decision_text = cell(
        "A3",
        field(
            '// criteria: name weight (1-5), …   then one option per line:  Option | score per criterion (1-5)\ncriteria: Salary 3, Growth 5, Commute 2, Team 4, Stability 3\nStay at current job | 3, 2, 4, 4, 5\nOffer from a startup | 4, 5, 2, 3, 2\nOffer from a large company | 5, 3, 3, 3, 4'
        ),
        label="decision_text",
        view={"widget": {"type": "textarea"}},
    )

    @cell("B3", label="decision")
    @computed
    def decision(self):
        criteria, options = [], []
        for line in self.decision_text().splitlines():
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            if line.lower().startswith('criteria:'):
                for item in line.split(':', 1)[1].split(','):
                    name, weight = item.strip().rsplit(' ', 1)
                    criteria.append((name, float(weight)))
            else:
                name, scores = line.split('|')
                options.append((name.strip(), [float(score) for score in scores.split(',')]))
        return {'criteria': criteria, 'options': options}

    @cell("B4", label="decision_verdict")
    @computed
    def decision_verdict(self):
        best, second = self.decision_table().iloc[0], self.decision_table().iloc[1] if len(self.decision_table()) > 1 else None
        margin = best['Score'] - (second['Score'] if second is not None else 0)
        if second is None:
            text = f"Only one option: {best['Option']}. Add alternatives — there are always some."
        elif margin < 5:
            text = (f"Close call: {best['Option']} ({best['Score']}) and {second['Option']} ({second['Score']}) are within "
                    f"{margin} points. The numbers will not decide this; your gut, or a missing criterion, will.")
        else:
            text = f"{best['Option']} leads with {best['Score']} of 100, {margin} points ahead of {second['Option']}."
        return text


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Project planner",
        "layout": {
            "noteOrder": [
                "H1",
                "H2",
                "Priorities!G1",
                "Planning!G1",
                "Goals!G1",
                "Review!G1",
                "Review!G2",
            ]
        },
    }
)
class ProjectPlannerWorkbook(Workbook):
    Board = worksheet(
        BoardWorksheet,
        grid={"columns": 8, "rows": 16},
        layout={
            "columnWidths": {
                "A": 260,
                "B": 200,
                "C": 220,
                "D": 220,
                "E": 220,
                "F": 220,
                "G": 220,
            }
        },
    )
    Priorities = worksheet(
        PrioritiesWorksheet,
        grid={"columns": 7, "rows": 14},
        layout={
            "columnWidths": {"A": 200, "B": 200, "C": 200, "D": 200, "E": 200, "F": 200}
        },
    )
    Planning = worksheet(
        PlanningWorksheet,
        grid={"columns": 7, "rows": 16},
        layout={
            "columnWidths": {"A": 200, "B": 200, "C": 200, "D": 200, "E": 200, "F": 200}
        },
    )
    Goals = worksheet(
        GoalsWorksheet,
        grid={"columns": 7, "rows": 22},
        layout={
            "columnWidths": {"A": 220, "B": 200, "C": 200, "D": 200, "E": 200, "F": 200}
        },
    )
    Review = worksheet(
        ReviewWorksheet,
        grid={"columns": 7, "rows": 12},
        layout={
            "columnWidths": {"A": 220, "B": 200, "C": 200, "D": 200, "E": 200, "F": 200}
        },
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
