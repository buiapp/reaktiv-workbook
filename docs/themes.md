# Themes

Choose a theme in **Settings → App → Theme**, or cycle through them with the theme button
in the toolbar: Follow system, Light, Dark, Nord, Midnight and Solarized Light. The choice
applies to every workbook on this device.

## Make your own

Choose **Export theme JSON…** for a starting file, edit the colours, then load it with
**Import JSON…** (or put several files in a folder and choose **Load theme folder…**).

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

- `name`, `type` (`light` or `dark`) and at least one colour are required. The example
  lists every supported key; omitted colours keep the default.
- Colours are six-digit hex values. The keys follow VS Code's names, but VS Code theme
  files can't be imported directly.
- Loading a theme with an existing name replaces it. After editing files, load them again.
- Charts, syntax colours and widgets keep their own styling.
