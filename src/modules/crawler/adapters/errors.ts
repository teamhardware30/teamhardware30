export type AdapterErrorCode = 'blocked' | 'rate_limited' | 'schema_invalid' | 'network';

/** A safe, typed error boundary between outbound HTTP/adapters and the pipeline. */
export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly sourceUrl?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AdapterSchemaError extends AdapterError {
  constructor(message: string, sourceUrl?: string, options?: ErrorOptions) {
    super('schema_invalid', message, sourceUrl, options);
  }
}

export class AdapterHttpError extends AdapterError {
  constructor(readonly status: number, sourceUrl: string) {
    super(
      status === 429 ? 'rate_limited' : status === 401 || status === 403 || status === 451 ? 'blocked' : 'network',
      `Request to ${sourceUrl} failed with HTTP ${status}`,
      sourceUrl,
    );
  }
}

export class RobotsBlockedError extends AdapterError {
  constructor(sourceUrl: string) {
    super('blocked', `Refused to fetch ${sourceUrl}: disallowed by robots.txt`, sourceUrl);
  }
}

export class SourceKillSwitchError extends AdapterError {
  constructor(readonly sourceId: string, sourceUrl?: string) {
    super('blocked', `Crawling is stopped by the kill switch for source ${sourceId}`, sourceUrl);
  }
}

export class AdapterNetworkError extends AdapterError {
  constructor(sourceUrl: string, options?: ErrorOptions) {
    super('network', `Request to ${sourceUrl} failed`, sourceUrl, options);
  }
}

export class ResponseTooLargeError extends AdapterError {
  constructor(sourceUrl: string, readonly maxBytes: number) {
    super('network', `Response from ${sourceUrl} exceeded the ${maxBytes}-byte limit`, sourceUrl);
  }
}
