import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { SourceAdapter } from './source-adapter.interface';
import { GreenhouseAdapter } from './greenhouse.adapter';
import { LeverAdapter } from './lever.adapter';
import { AshbyAdapter } from './ashby.adapter';
import { RemotiveAdapter } from './remotive.adapter';
import { ArbeitnowAdapter } from './arbeitnow.adapter';
import { JsonLdAdapter } from './jsonld.adapter';
import { HtmlAdapter } from './html.adapter';

@Injectable()
export class AdapterRegistry {
  private readonly adapters: Map<Source['kind'], SourceAdapter>;

  constructor(
    greenhouse: GreenhouseAdapter,
    lever: LeverAdapter,
    ashby: AshbyAdapter,
    remotive: RemotiveAdapter,
    arbeitnow: ArbeitnowAdapter,
    jsonld: JsonLdAdapter,
    html: HtmlAdapter,
  ) {
    this.adapters = new Map<Source['kind'], SourceAdapter>(
      [greenhouse, lever, ashby, remotive, arbeitnow, jsonld, html].map((adapter) => [adapter.kind, adapter]),
    );
  }

  get(kind: Source['kind']): SourceAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`No crawler adapter registered for source kind "${kind}"`);
    }
    return adapter;
  }
}
