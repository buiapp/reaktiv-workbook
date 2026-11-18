import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAccessComponent } from './agent-access.component';

beforeEach(() => localStorage.clear());

describe('MCP server information', () => {
  it('shows the server address and setup before sharing and keeps them visible while connected', async () => {
    const fixture = TestBed.createComponent(AgentAccessComponent);
    fixture.componentRef.setInput('workbookName', 'My workbook');
    fixture.detectChanges(); await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h2')?.textContent).toContain('MCP server');
    expect(host.querySelector('[aria-label="MCP server information"]')?.textContent).toContain('http://127.0.0.1:8766');
    expect(host.querySelector('[aria-label="MCP server information"]')?.textContent).toContain('Not checked');
    expect(host.querySelector('[aria-label="MCP server setup"]')?.textContent).toContain('reaktiv-workbook-mcp --port');
    fixture.componentRef.setInput('shared', true);
    fixture.componentRef.setInput('status', 'Connected');
    fixture.detectChanges();
    expect(host.querySelector('[aria-label="MCP server information"]')?.textContent).toContain('Connected');
    expect(host.querySelector('[aria-label="MCP server setup"] button')?.textContent).toContain('Copy MCP URL');
    expect(host.querySelector('[aria-label="MCP server information"]')?.textContent).toContain('http://127.0.0.1:8766/mcp');
    expect(host.textContent).not.toContain('stdio');
    fixture.destroy();
  });
});

describe('Pairing token controls and OpenCode configuration', () => {
  it('applies a network bridge address and explains wildcard listen addresses', () => {
    const fixture = TestBed.createComponent(AgentAccessComponent);
    fixture.componentRef.setInput('workbookName', 'My workbook');
    const component = fixture.componentInstance;
    const apply = vi.fn();
    component.enabled.subscribe(apply);
    component.endpoint = '192.0.2.10';
    component.share();
    expect(apply).toHaveBeenCalledWith({ endpoint: 'http://192.0.2.10:8766', token: component.token });
    expect(component.mcpUrl()).toBe('http://192.0.2.10:8766/mcp');
    expect(JSON.parse(component.openCodeConfiguration()).mcp.servers['reaktiv-workbook'].url).toBe(component.mcpUrl());
    component.endpoint = '0.0.0.0';
    component.share();
    expect(apply).toHaveBeenCalledOnce();
    expect(component.error()).toContain('server listen addresses');
    fixture.destroy();
  });

  it('reveals and copies the token before and during sharing', async () => {
    const fixture = TestBed.createComponent(AgentAccessComponent);
    fixture.componentRef.setInput('workbookName', 'My workbook');
    fixture.detectChanges(); await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const token = fixture.componentInstance.token;
    const field = host.querySelector<HTMLInputElement>('#agent-pairing-token')!;
    expect(field.type).toBe('password');
    host.querySelector<HTMLButtonElement>('[aria-label="Show pairing token"]')!.click();
    fixture.detectChanges();
    expect(field.type).toBe('text');
    expect(field.value).toBe(token);
    const write = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    try {
      await fixture.componentInstance.copyToken();
      expect(write).toHaveBeenCalledWith(token);
      expect(fixture.componentInstance.copyMessage()).toBe('Pairing token copied.');
      fixture.componentRef.setInput('shared', true);
      fixture.detectChanges();
      expect(field.readOnly).toBe(true);
      expect(host.querySelector('[aria-label="Copy pairing token"]')).not.toBeNull();
      host.querySelector<HTMLButtonElement>('[aria-label="Hide pairing token"]')!.click();
      fixture.detectChanges();
      expect(field.type).toBe('password');
    } finally { vi.unstubAllGlobals(); fixture.destroy(); }
  });

  it('copies OpenCode remote HTTP settings without a local server command', async () => {
    const fixture = TestBed.createComponent(AgentAccessComponent);
    fixture.componentRef.setInput('workbookName', 'My workbook');
    const component = fixture.componentInstance;
    component.endpoint = 'http://127.0.0.1:9876';
    const configuration = JSON.parse(component.openCodeConfiguration());
    expect(configuration.mcp.servers['reaktiv-workbook']).toEqual({
      type: 'remote', url: 'http://127.0.0.1:9876/mcp', oauth: false,
      timeout: { execution: 65000 }, headers: { Authorization: 'Bearer ' + component.token },
    });
    expect(configuration.mcp.servers['reaktiv-workbook'].command).toBeUndefined();
    const write = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    try {
      await component.copyOpenCodeConfiguration();
      expect(write).toHaveBeenCalledWith(component.openCodeConfiguration());
      await component.copyMcpUrl();
      expect(write).toHaveBeenLastCalledWith('http://127.0.0.1:9876/mcp');
    } finally { vi.unstubAllGlobals(); fixture.destroy(); }
  });
});
