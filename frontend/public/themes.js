/* Shared by first paint and Angular. JSON themes can set only these colour tokens. */
(function () {
  'use strict';
  const key = 'reaktiv-workbook:theme';
  const customKey = 'reaktiv-workbook:themes:v1';
  const tokens = {
    'editor.background': 'paper', 'editor.foreground': 'ink',
    'sideBar.background': 'panel', 'descriptionForeground': 'muted',
    'panel.border': 'line', 'input.border': 'line-strong',
    'list.hoverBackground': 'hover', 'list.activeSelectionBackground': 'selected',
    'focusBorder': 'focus', 'textLink.foreground': 'purple',
    'badge.background': 'purple-soft', 'errorForeground': 'danger',
    'statusBar.background': 'lime', 'statusBar.foreground': 'lime-dark',
    'editorWarning.foreground': 'orange', 'editorWarning.background': 'orange-soft',
  };
  const palette = (id, name, type, values) => ({id, name, type, colors: Object.fromEntries(
    Object.keys(tokens).map((k, i) => [k, values[i]]))});
  const builtins = [
    {id:'system', name:'Follow system'}, {id:'light', name:'Light', type:'light'}, {id:'dark', name:'Dark', type:'dark'},
    palette('nord', 'Nord', 'dark', ['#2e3440','#eceff4','#3b4252','#aeb9cb','#4c566a','#69768c','#434c5e','#4c566a','#88c0d0','#88c0d0','#364957','#bf616a','#354b43','#a3be8c','#ebcb8b','#493f2e']),
    palette('midnight', 'Midnight', 'dark', ['#111827','#e5e7eb','#172033','#9ca3af','#29364b','#475569','#243149','#30415e','#a78bfa','#a78bfa','#30264b','#f87171','#17342e','#6ee7b7','#fbbf24','#42331c']),
    palette('solarized', 'Solarized Light', 'light', ['#fdf6e3','#586e75','#eee8d5','#657b83','#ded6c1','#b2b6a9','#e9e2ce','#d8e6df','#268bd2','#268bd2','#e0eaf0','#dc322f','#e6edcf','#647600','#b58900','#f6edcf']),
  ];
  function parse(text) {
    if (text.length > 65536) throw new Error('Theme JSON must be at most 64 KiB.');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 ||
        !['light','dark'].includes(value.type) || !value.colors ||
        typeof value.colors !== 'object' || Array.isArray(value.colors)) {
      throw new Error('A theme needs a name, type (light or dark), and colors object.');
    }
    const colors = {};
    for (const [k,v] of Object.entries(value.colors)) {
      if (!(Object.hasOwn(tokens,k))) throw new Error('Unknown theme color: ' + k);
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Color ' + k + ' must be #RRGGBB.');
      colors[k] = v;
    }
    if (!Object.keys(colors).length) throw new Error('A theme needs at least one color.');
    // Name gives a stable identity when a file is edited and re-imported.
    return {id:'custom:' + value.name.trim(), name:value.name.trim(), type:value.type, colors};
  }
  function custom() {
    try {
      const values = JSON.parse(localStorage.getItem(customKey) || '[]');
      return Array.isArray(values) ? values.slice(0,100).map(v => parse(JSON.stringify(v))) : [];
    } catch { return []; }
  }
  function all() { return [...builtins, ...custom()]; }
  function apply(id) {
    const theme = all().find(t => t.id === id) || builtins[0];
    const root = document.documentElement;
    for (const token of new Set(Object.values(tokens))) root.style.removeProperty('--theme-' + token);
    if (theme.type) root.dataset.theme = theme.type;
    else delete root.dataset.theme;
    for (const [k,v] of Object.entries(theme.colors || {})) root.style.setProperty('--theme-' + tokens[k], v);
    return theme.id;
  }
  window.reaktivThemes = {key,customKey,builtins,parse,all,apply};
  try { apply(localStorage.getItem(key) || 'system'); } catch { apply('system'); }
})();
