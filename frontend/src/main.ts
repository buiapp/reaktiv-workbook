// Keep framework/app imports behind a catchable boundary: diagnostics run first.
window.reaktivStartup?.log('bootstrap-import', 'Loading application modules');
void import('./bootstrap')
  .then(({startApplication}) => {
    window.reaktivStartup?.log('bootstrap-start', 'Starting Angular');
    return startApplication();
  })
  .then(() => window.reaktivStartup?.ready())
  .catch(error => { console.error(error); window.reaktivStartup?.fail(error); });
