/* Runs before Angular and its module graph. Keep dependency-free and compatible with WebView2. */
(function () {
  'use strict';
  var key = 'reaktiv-workbook:startup-diagnostics:v1';
  var entries = [], started = false, failed = false, phase = 'Loading application scripts';
  var timer;
  function describe(value) {
    try {
      var summary = String(value);
      var stack = value instanceof Error ? String(value.stack || '') : '';
      return (stack && stack.indexOf(summary) === -1 ? summary + '\n' + stack : stack || summary).slice(0, 4096);
    }
    catch (_) { return '[Unprintable error]'; }
  }
  async function bounded(promise) {
    var timeout;
    try {
      return await Promise.race([promise, new Promise(function (_, reject) {
        timeout = setTimeout(function () { reject(new Error('Diagnostic request timed out')); }, 1500);
      })]);
    } finally { clearTimeout(timeout); }
  }
  function log(kind, message) {
    var entry = {time: new Date().toISOString(), phase: kind, message: describe(message)};
    entries.push(entry);
    if (entries.length > 60) entries.shift();
    try { localStorage.setItem(key, JSON.stringify(entries)); } catch (_) {}
  }
  function display() {
    var screen = document.getElementById('startup-screen');
    if (!screen) return;
    screen.hidden = started;
    document.getElementById('startup-title').textContent = failed ? 'Reaktiv Workbook could not start' : 'Starting Reaktiv Workbook';
    document.getElementById('startup-status').textContent = failed ? phase.split('\n')[0].slice(0, 280) : phase;
  }
  function fail(error) {
    if (started) return; // Runtime errors are logged; never replace an already running workbook.
    failed = true; phase = describe(error);
    clearTimeout(timer); log('startup-failed', phase); display();
  }
  function safeUrl(value) {
    try {
      var url = new URL(value, location.href);
      url.search = ''; url.hash = ''; url.username = ''; url.password = '';
      return url.href;
    }
    catch (_) { return 'unknown resource'; }
  }
  async function report() {
    return 'Frontend diagnostics\nPage: ' + safeUrl(location.href) + '\nUser agent: ' + navigator.userAgent +
      '\nState: ' + (started ? 'ready' : failed ? 'failed' : 'starting') + '\n' +
      entries.map(function (entry) { return entry.time + ' [' + entry.phase + '] ' + entry.message; }).join('\n');
  }
  async function copy() {
    var button = document.getElementById('startup-copy');
    var output = document.getElementById('startup-report');
    button.disabled = true;
    try {
      var text = await report(); output.value = text;
      var copied = false;
      try {
        await bounded(navigator.clipboard.writeText(text));
        copied = true;
      } catch (_) {}
      document.getElementById('startup-details').open = true;
      document.getElementById('startup-copy-status').textContent = copied ? 'Diagnostics copied.' : 'Select and copy the diagnostics below.';
      if (!copied) { output.focus({preventScroll: true}); output.select(); }
    } finally { button.disabled = false; }
  }
  window.reaktivStartup = {
    log: function (kind, message) { phase = message; log(kind, message); if (!failed) display(); },
    ready: function () { started = true; clearTimeout(timer); log('frontend-ready', 'Application rendered'); display(); },
    fail: fail,
    report: report
  };
  window.addEventListener('error', function (event) {
    if (event.target && event.target !== window) {
      var source = event.target.src || event.target.href;
      if (source) {
        var message = 'Could not load ' + safeUrl(source);
        log('resource-error', message);
        if (!started && event.target.tagName === 'SCRIPT') fail(message);
      }
    } else {
      var error = event.error || event.message || 'Unknown JavaScript error';
      log('javascript-error', describe(error)); fail(error);
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    log('unhandled-rejection', describe(event.reason)); fail(event.reason);
  });
  var originalError = console.error;
  console.error = function () {
    log('console-error', Array.prototype.map.call(arguments, describe).join(' ').slice(0, 4096));
    originalError.apply(console, arguments);
  };
  log('frontend-script', 'Startup diagnostics installed; ' + navigator.userAgent);
  timer = setTimeout(function () {
    if (started || failed) return;
    phase = 'Startup is taking longer than expected. Copy diagnostics to investigate. This window will recover if startup completes.';
    log('startup-timeout', phase); display();
  }, 20000);
  var mounted = false;
  function mount() {
    if (mounted) return;
    var button = document.getElementById('startup-copy');
    if (!button) {
      if (document.readyState === 'loading') setTimeout(mount, 25);
      return;
    }
    mounted = true;
    button.addEventListener('click', function () { void copy(); });
    display();
  }
  // Module scripts can stall DOMContentLoaded. Bind as soon as the static UI is parsed.
  setTimeout(mount, 0);
  document.addEventListener('DOMContentLoaded', mount);
})();
