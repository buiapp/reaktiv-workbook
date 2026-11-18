import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

export function startApplication() {
  return bootstrapApplication(App, appConfig);
}
