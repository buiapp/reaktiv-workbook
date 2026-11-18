interface Window {
  reaktivStartup?: {
    log(phase: string, message: string): void;
    ready(): void;
    report(): Promise<string>;
    fail(error: unknown): void;
  };
}
