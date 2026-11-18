import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { readAgentPairing, rememberAgentPairing, validateAgentEndpoint, type AgentPairing } from './agent-connection';

@Component({
  selector: 'app-agent-access',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="dismissed.emit()">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="agent-access-title" (click)="$event.stopPropagation()" (keydown.escape)="dismissed.emit()">
        <header><h2 id="agent-access-title">MCP server / Agent access</h2><button type="button" aria-label="Close agent access" (click)="dismissed.emit()">×</button></header>
        <p>Collaborate with an agent on <strong>{{ workbookName() }}</strong> using its running Python kernel.</p>
        <section class="server-info" aria-label="MCP server information">
          <h3>MCP server</h3>
          <p>Start the editor with <code>reaktiv-workbook edit FILE --mcp</code>: it serves MCP for agents and shares this workbook as soon as it opens. To use an MCP server started separately, enter its address and pairing token below.</p>
          <dl><dt>Bridge address</dt><dd><code>{{ endpoint }}</code></dd>
            <dt>Connection</dt><dd>{{ shared() ? status() : 'Not checked · workbook is not shared' }}</dd>
            <dt>MCP URL</dt><dd><code>{{ mcpUrl() }}</code></dd>
            <dt>MCP transport</dt><dd>Authenticated Streamable HTTP</dd></dl>
        </section>
        <label for="agent-pairing-token">Pairing token</label>
        <div class="token-row">
          <input #tokenField id="agent-pairing-token" [type]="tokenVisible() ? 'text' : 'password'" [(ngModel)]="token"
            [readOnly]="shared()" (focus)="tokenField.select()" autocomplete="off" spellcheck="false" />
          <button type="button" [attr.aria-label]="tokenVisible() ? 'Hide pairing token' : 'Show pairing token'"
            [attr.aria-pressed]="tokenVisible()" (click)="tokenVisible.set(!tokenVisible())">{{ tokenVisible() ? 'Hide' : 'Show' }}</button>
          <button type="button" aria-label="Copy pairing token" (click)="copyToken()">Copy</button>
        </div>
        @if (copyMessage()) { <p role="status">{{ copyMessage() }}</p> }
        <p class="status" role="status">{{ activity() || status() }}</p>
        @if (lastActivity()) { <p role="status">{{ lastActivity() }}</p> }
        @if (shared()) {
          <p>Agents can see your current worksheet, visible note, selected cells and open inspector, inspect results, dependencies and logs, edit cells, notes and action methods, run actions, change colors/grid sizes, and control the kernel (including restarting Python). Edits appear here, remain unsaved, and can be undone. Your cell drafts are protected.</p>
          <button type="button" class="primary" (click)="revoked.emit()">Stop sharing this workbook</button>
        } @else {
          <p>Add the MCP URL and token to your agent client, then share this workbook. Repeat in other windows to share more workbooks.</p>
          <label>Bridge address<input type="text" inputmode="url" [(ngModel)]="endpoint" placeholder="http://192.0.2.10:8766" /></label>
          <p class="muted">Use the server's IP address or hostname. 0.0.0.0 is a server listen address, not a destination. For direct network access, configure its listen address and allow its reachable hostname.</p>
          <p class="muted">Pairing is remembered on this device. Sharing applies only to this open workbook and ends when you open another file or close the window.</p>
          <button type="button" class="primary" [disabled]="!kernelRunning()" (click)="share()">Share this workbook</button>
          @if (!kernelRunning()) { <p>Start the workbook kernel to enable sharing.</p> }
        }
        <section class="server-info" aria-label="MCP server setup">
          <h3>Connect your agent</h3>
          <p>A separate MCP server: set <code>REAKTIV_WORKBOOK_MCP_TOKEN</code> to the pairing token above, then run:</p>
          <pre>reaktiv-workbook-mcp --port {{ bridgePort() }}</pre>
          <button type="button" (click)="copyMcpUrl()">Copy MCP URL</button>
          <button type="button" (click)="copyOpenCodeConfiguration()">Copy OpenCode HTTP configuration</button>
          <details><summary>OpenCode 2 / another host</summary>
            <p>OpenCode uses the HTTP URL and token; it does not need this server package installed.</p>
            <p>For another host, either bind the server to its network address with --host, or keep the default loopback listener and use SSH forwarding.</p>
            <pre>ssh -N -L {{ bridgePort() }}:127.0.0.1:{{ bridgePort() }} user&#64;reaktiv-host</pre>
            <pre>{{ openCodeConfiguration() }}</pre>
          </details>
        </section>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </section>
    </div>
  `,
  styles: `
    :host { position:fixed; inset:0; z-index:1100; }
    .backdrop { display:grid; place-items:center; padding:24px; height:100%; background:#0006; }
    .dialog { background:var(--surface,Canvas); color:var(--ink,CanvasText); border:1px solid var(--border,#8886); border-radius:14px; padding:24px; width:min(540px,100%); max-height:85dvh; overflow:auto; box-shadow:0 20px 80px #0004; font-size:14px; line-height:1.5; }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; } h2 { margin:0; font-size:20px; }
    label { display:grid; gap:4px; margin:12px 0; } input { color:inherit; background:transparent; border:1px solid var(--border,#8886); padding:8px; border-radius:6px; width:100%; box-sizing:border-box; }
    button { cursor:pointer; font:inherit; color:inherit; background:transparent; border:1px solid var(--border,#8886); border-radius:6px; padding:7px 12px; } button:disabled { cursor:default; opacity:.5; } button.primary { margin-top:16px; font-weight:600; }
    .status { font-weight:600; } .muted { color:var(--muted); font-size:12px; } .error { color:var(--danger,#c33); } pre { overflow:auto; font-size:11px; user-select:text; } details { margin-top:12px; } li { margin:8px 0; }
    .server-info { border-top:1px solid var(--line,#8886); margin-top:16px; padding-top:12px; } h3 { margin:0; font-size:15px; } dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 16px; } dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; } code { font-size:12px; }
    input, pre { user-select:text; } .token-row { display:flex; gap:6px; } .token-row input { min-width:0; flex:1; font-family:monospace; } .checkbox-row { display:flex; align-items:center; gap:8px; } .checkbox-row input { width:auto; } .token-row button { flex:none; } .server-info > button { margin:4px 6px 4px 0; }
  `,
})
export class AgentAccessComponent {
  readonly workbookName = input.required<string>();
  readonly kernelRunning = input(false);
  readonly shared = input(false);
  readonly status = input('Not shared');
  readonly activity = input<string | null>(null);
  readonly lastActivity = input<string | null>(null);
  readonly enabled = output<AgentPairing>();
  readonly revoked = output<void>();
  readonly dismissed = output<void>();
  private readonly initial = readAgentPairing();
  endpoint = this.initial.endpoint;
  token = this.initial.token;
  readonly error = signal<string | null>(null);
  readonly copyMessage = signal<string | null>(null);
  readonly tokenVisible = signal(false);

  bridgePort(): string {
    try { return new URL(validateAgentEndpoint(this.endpoint)).port || '80'; }
    catch { return '8766'; }
  }

  mcpUrl(): string {
    try { return validateAgentEndpoint(this.endpoint) + '/mcp'; }
    catch { return 'Enter a valid bridge address.'; }
  }

  async copyMcpUrl(): Promise<void> {
    try {
      const endpoint = validateAgentEndpoint(this.endpoint);
      await this.writeClipboard(endpoint + '/mcp');
      this.copyMessage.set('MCP HTTP URL copied.');
      this.error.set(null);
    } catch (error) { this.error.set(String(error)); }
  }

  openCodeConfiguration(): string {
    try {
      return JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { servers: { 'reaktiv-workbook': {
        type: 'remote', url: validateAgentEndpoint(this.endpoint) + '/mcp', oauth: false,
        timeout: { execution: 65000 }, headers: { Authorization: 'Bearer ' + this.token },
      } } } }, null, 2);
    } catch { return 'Enter a valid bridge address.'; }
  }

  private async writeClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async copyToken(): Promise<void> {
    try {
      await this.writeClipboard(this.token);
      this.copyMessage.set('Pairing token copied.');
      this.error.set(null);
    } catch (error) { this.error.set(String(error)); }
  }

  async copyOpenCodeConfiguration(): Promise<void> {
    try {
      const endpoint = validateAgentEndpoint(this.endpoint);
      if (this.token.length < 32) throw new Error('Pairing token must have at least 32 characters.');
      await this.writeClipboard(this.openCodeConfiguration());
      rememberAgentPairing({ endpoint, token: this.token });
      this.copyMessage.set('OpenCode HTTP configuration copied. Enable MCP on the Reaktiv Workbook host and share this workbook.');
      this.error.set(null);
    } catch (error) { this.error.set(String(error)); }
  }

  share(): void {
    try {
      const endpoint = validateAgentEndpoint(this.endpoint);
      if (this.token.length < 32) throw new Error('Pairing token must have at least 32 characters.');
      this.error.set(null);
      this.endpoint = endpoint;
      this.enabled.emit({ endpoint, token: this.token });
    } catch (error) { this.error.set(String(error)); }
  }
}
