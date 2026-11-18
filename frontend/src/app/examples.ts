/** How far into the app an example goes: the Examples menu groups them in this order. */
export type ExampleLevel = 'start' | 'simple' | 'useful' | 'impressive';

export const EXAMPLE_LEVELS: readonly { level: ExampleLevel; label: string }[] = [
  { level: 'start', label: 'Start here' },
  { level: 'simple', label: 'Simple' },
  { level: 'useful', label: 'Useful' },
  { level: 'impressive', label: 'Impressive' },
];

/** Example workbooks bundled with the app (files in `examples/`), in menu order. */
export interface ExampleWorkbook {
  file: string;
  title: string;
  /** One line for the Getting started dialog: what the example shows. */
  description: string;
  level: ExampleLevel;
}

// Keep each entry's field order (file, title, description, level): the website's
// static page builder (reaktiv-workbook-site, scripts/build_pages.py) reads it.
export const EXAMPLES: readonly ExampleWorkbook[] = [
  { file: 'welcome.workbook.py', title: 'Welcome to Reaktiv Workbook', description: 'The ideas in five short notes: cells, reactivity, widgets, actions and the Python file.', level: 'start' },
  { file: 'docs/guide.workbook.py', title: 'Guide: charts, HTML, widgets', description: 'How to show results: tables, charts, HTML cells, controls, and your own widgets.', level: 'start' },
  { file: 'budget.workbook.py', title: 'Monthly budget', description: 'Sliders, a spending chart and a savings goal that follow every change.', level: 'simple' },
  { file: 'trip-planner-app.workbook.py', title: 'Trip planner', description: 'A small app made of list, choice, date, and button widgets.', level: 'simple' },
  { file: 'model-fit.workbook.py', title: 'Model fitting', description: 'Polynomial degree, noise and samples: watch underfitting and overfitting happen.', level: 'useful' },
  { file: 'sales-performance-dashboard.workbook.py', title: 'Sales dashboard', description: 'A filterable report with KPI tables and plots.', level: 'useful' },
  { file: 'project-planner.workbook.py', title: 'Project planner', description: 'Kanban board, priorities, forecasts, OKRs, habits, and a weekly review.', level: 'useful' },
  { file: 'calorie-coach.workbook.py', title: 'Calorie coach', description: 'Calories and macros to lose, keep, or gain weight, with a weekly check-in.', level: 'useful' },
  { file: 'scheduled-pipeline.workbook.py', title: 'Live monitor', description: 'Clock cells: poll a sensor, alert, and report on a timer.', level: 'useful' },
  { file: 'signal-lab.workbook.py', title: 'Signal lab', description: 'Filter a noisy signal; time, spectrum and filter plots follow every slider.', level: 'impressive' },
  { file: 'personal-life-dashboard.workbook.py', title: 'Personal life dashboard', description: 'Money, home, health and household in one model with many charts.', level: 'impressive' },
  { file: 'wave-laboratory.workbook.py', title: 'Wave laboratory', description: 'An interactive widget with sliders and an animated tracer; cells follow it.', level: 'impressive' },
  { file: 'vectors.workbook.py', title: 'Vectors you can touch', description: 'Drag a vector; Python computes its length and angle.', level: 'impressive' },
  { file: 'binary-search.workbook.py', title: 'Binary search explainer', description: 'Step through a search, one comparison at a time.', level: 'impressive' },
];
