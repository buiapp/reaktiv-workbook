import { Injectable, signal } from '@angular/core';

interface TimingEntry {
  at: string;
  operation: string;
  durationMs: number;
  metrics: Record<string, number>;
}

/** Opt-in, bounded timing metadata. Never retain a request, response, value or source. */
@Injectable({providedIn:'root'})
export class PerformanceDiagnostics {
  readonly enabled = signal(false);
  private entries: TimingEntry[] = [];
  private memoryProbe: (() => Promise<unknown>) | null = null;
  private memorySamples: {at:string;reason:string;data:unknown}[] = [];
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private memoryBusy = false;

  setMemoryProbe(probe: (() => Promise<unknown>) | null): void { this.memoryProbe = probe; }

  private async sampleMemory(reason:string):Promise<void> {
    if (!this.memoryProbe || this.memoryBusy) return;
    const generation=this.generation;
    this.memoryBusy=true;
    let timeout:ReturnType<typeof setTimeout> | undefined;
    try {
      const data=await Promise.race([this.memoryProbe(),new Promise(resolve=>{
        timeout=setTimeout(()=>resolve({unavailable:'Memory sample timed out'}),3500);
      })]);
      if (generation!==this.generation) return;
      this.memorySamples.push({at:new Date().toISOString(),reason,data});
      if (this.memorySamples.length>120) this.memorySamples.shift();
    } catch {
      if (generation===this.generation) this.memorySamples.push({at:new Date().toISOString(),reason,data:{unavailable:'Memory sample failed'}});
      if (this.memorySamples.length>120) this.memorySamples.shift();
    } finally { clearTimeout(timeout); this.memoryBusy=false; }
  }
  private frame = 0;
  private generation = 0;
  private sessionStarted: string | null = null;

  start(): void {
    this.stop();
    this.entries = [];
    this.memorySamples = [];
    void this.sampleMemory('recording-start');
    this.memoryTimer=setInterval(()=>{
      if (document.visibilityState==='visible') void this.sampleMemory('interval');
    },5000);
    this.sessionStarted = new Date().toISOString();
    this.enabled.set(true);
    let previous = performance.now();
    let wasVisible = document.visibilityState === 'visible';
    const sample = (now: number) => {
      if (!this.enabled()) return;
      const visible = document.visibilityState === 'visible';
      if (visible && wasVisible && now-previous >= 100) this.record('ui.frame-gap',now-previous);
      previous=now; wasVisible=visible;
      this.frame = requestAnimationFrame(sample);
    };
    this.frame = requestAnimationFrame(sample);
  }

  stop(): void {
    this.enabled.set(false);
    if (this.memoryTimer!==null) clearInterval(this.memoryTimer);
    this.memoryTimer=null;
    this.generation++;
    cancelAnimationFrame(this.frame);
  }

  begin(operation: string, metrics: Record<string,number> = {}): (extra?: Record<string,number>) => void {
    if (!this.enabled()) return () => {};
    const started=performance.now(), generation=this.generation;
    return extra => {
      if (generation === this.generation) this.record(operation, performance.now()-started, {...metrics,...extra});
    };
  }

  record(operation: string, durationMs: number, metrics: Record<string,number> = {}): void {
    if (!this.enabled()) return;
    this.entries.push({at:new Date().toISOString(),operation,durationMs:Math.round(durationMs*100)/100,
      metrics:Object.fromEntries(Object.entries(metrics).filter(([,v])=>Number.isFinite(v)))});
    if (this.entries.length>400) this.entries.shift();
    if (durationMs>=250) window.reaktivStartup?.log('performance',JSON.stringify({operation,durationMs:Math.round(durationMs),metrics}));
  }

  nextFrame(operation: string): void {
    const finish=this.begin(operation);
    if (this.enabled()) requestAnimationFrame(()=>finish());
  }

  snapshot(): object {
    return {format:1,startedAt:this.sessionStarted,recording:this.enabled(),
      userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
      viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},
      visibility:document.visibilityState,entries:[...this.entries]};
  }

  async report(context: Record<string,unknown>): Promise<string> {
    await this.sampleMemory('export');
    const memory={format:1,intervalMs:5000,maxSamples:120,samples:[...this.memorySamples]};
    const timing=this.snapshot();
    let startup='Startup monitor unavailable';
    try { startup=await window.reaktivStartup?.report() ?? startup; } catch { /* Timing report remains usable. */ }
    return JSON.stringify({performance:timing,memory,context,startup},null,2);
  }
}
