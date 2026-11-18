# Themes

Open **Settings → App → Theme**, or use the theme button in the toolbar to cycle
through available themes. Choices include Follow system, Light, Dark, Nord,
Midnight and Solarized Light. The choice applies across workbook windows on this
device; it is not saved in a workbook.

## Create your own

Use **Export theme JSON…** to get a starting file, then edit it in a text editor:

```json
{
  "name": "My ocean theme",
  "type": "dark",
  "colors": {
    "editor.background": "#142536",
    "editor.foreground": "#e6edf3",
    "sideBar.background": "#1a3045",
    "descriptionForeground": "#a3b8cc",
    "panel.border": "#31465c",
    "input.border": "#526b83",
    "list.hoverBackground": "#243c53",
    "list.activeSelectionBackground": "#34516d",
    "focusBorder": "#81c7ec",
    "textLink.foreground": "#81c7ec",
    "badge.background": "#253955",
    "errorForeground": "#ff8585",
    "statusBar.background": "#193c36",
    "statusBar.foreground": "#9fdbb5",
    "editorWarning.foreground": "#edc47c",
    "editorWarning.background": "#403621"
  }
}
```

Import the file with **Import JSON…**, or put several files in a folder and choose
**Load theme folder…**. Only `.json` files directly inside the chosen folder are
loaded. Browsers supporting folder upload use their folder picker. Loading a folder imports its palettes, not a live link.
After editing files, load the folder again. Matching theme names replace previous
versions. A custom theme can be removed with **Remove theme**.

The required fields are `name`, `type` (`light` or `dark`), and `colors` with at least
one entry. The example lists every supported colour key. Omitted colours retain
the default light/dark appearance. Only six-digit hex colours are accepted; CSS,
URLs and unknown colour keys are rejected. Imports are validated as a batch: an
invalid file leaves existing themes untouched. Limits: 100 custom themes, 64 KiB
per file. Storage failures are reported rather than claiming an import succeeded.

The JSON format uses familiar VS Code-style colour keys, but does not import
arbitrary VS Code extensions, token rules or their full theme schema. Theme
palettes cover shared app surfaces, text, borders, selection and accent colours.
Chart images, library-owned widget styles, syntax token colours and some semantic
status colours retain their own styling. The theme's light/dark type still controls
their default colour scheme where supported.

## Implementation

`frontend/public/themes.js` owns validation, built-in palettes and application of CSS
variables. It runs before first paint and exposes the same API to Angular through
`frontend/src/app/themes.ts`. Theme colours override shared `--theme-*` tokens; original
`light-dark(...)` pairs remain fallbacks, preserving the original light/dark
appearance. Never turn arbitrary JSON keys into CSS properties or inject JSON as
stylesheet text. Theme files contain data only.

Preferences are held in local storage under `reaktiv-workbook:theme` and
`reaktiv-workbook:themes:v1`. Changes synchronize to other open windows. No Python
kernel is needed to choose, import or export a theme.
