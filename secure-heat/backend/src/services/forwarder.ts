import type { Forwarder } from './ports.js';

/** Default: the in-app forecasting module reads FORWARDED rows from the database via the trusted-telemetry API. */
export class NoopForwarder implements Forwarder { async forward(): Promise<void> {} }

/** Optional integration boundary for an EXTERNAL forecasting service. Only ever called for ACCEPTed telemetry. */
export class HttpForwarder implements Forwarder {
  constructor(private readonly url: string, private readonly token: string, private readonly timeoutMs = 3000) {}
  async forward(t: Parameters<Forwarder['forward']>[0]): Promise<void> {
    const res = await fetch(`${this.url}/ingest`, {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(t),
    });
    if (!res.ok) throw new Error(`forecasting API responded ${res.status}`);
  }
}
