import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it, vi } from 'vitest';

import type { CompleteCostExplorerResult } from '../functions/cost-explorer-api/aws-adapter';
import {
  createCostCsv,
  createCostCsvExporter,
} from '../functions/cost-explorer-api/csv';

const request: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-06-01', end: '2026-08-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [
    { type: 'DIMENSION', key: 'SERVICE' },
    { type: 'DIMENSION', key: 'REGION' },
  ],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

function result(rowCount = 2): CompleteCostExplorerResult {
  return {
    source: 'CACHE',
    asOf: '2026-08-03T12:00:00.000Z',
    currencyOrUnit: 'USD',
    estimated: false,
    overview: { total: '3.3000000000001', average: '1.65000000000005' },
    periods: [
      { start: '2026-06-01', end: '2026-07-01', estimated: false },
      { start: '2026-07-01', end: '2026-08-01', estimated: false },
    ],
    series: [],
    breakdown: Array.from({ length: rowCount }, (_, index) => ({
      groupValues:
        index === 0
          ? ['Service, "Quoted"', 'line\nbreak']
          : [`=unsafe-${index}`, 'ap-southeast-1'],
      values: ['1.0000000000001', '2.3'],
      total: '3.3000000000001',
      estimated: false,
    })),
    comparisonDrivers: [],
    pageCount: 2,
  };
}

describe('createCostCsv', () => {
  it('creates UTF-8 BOM CSV with escaped groups and transposed ISO-date columns', () => {
    const bytes = createCostCsv(result(), request);
    const text = new TextDecoder().decode(bytes);

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain(
      'Group 1,Group 2,Currency/Unit,Total,2026-06-01,2026-07-01\r\n',
    );
    expect(text).toContain(
      '"Service, ""Quoted""","line\nbreak",USD,3.3000000000001,1.0000000000001,2.3',
    );
    expect(text).toContain("'=unsafe-1,ap-southeast-1,USD");
  });

  it('exports every breakdown row without cache/provider/internal fields', () => {
    const text = new TextDecoder().decode(createCostCsv(result(60), request));

    expect(text).toContain("'=unsafe-59");
    expect(text).not.toContain('CACHE');
    expect(text).not.toContain('pageCount');
    expect(text).not.toContain('2026-08-03T12:00:00.000Z');
  });

  it('rejects rows whose period values do not align with the report periods', () => {
    const invalid = result();
    invalid.breakdown[0].values = ['1'];

    expect(() => createCostCsv(invalid, request)).toThrow();
  });
});

describe('private CSV export', () => {
  it('writes an encrypted private object and returns only a five-minute URL and filename', async () => {
    const send = vi.fn(async (command: unknown) => {
      void command;
      return {};
    });
    const presignGet = vi.fn().mockResolvedValue('https://private.example/download');
    const exporter = createCostCsvExporter({
      s3: { send },
      bucket: 'cashight-private-exports',
      now: () => new Date('2026-08-09T12:00:00.000Z'),
      randomUUID: () => '51ae8b2c-d0d4-4a49-87ee-662083d133f6',
      presignGet,
    });

    const response = await exporter.exportCsv(
      'primary',
      'a'.repeat(64),
      result(),
      request,
    );

    const putInput = (
      send.mock.calls[0][0] as { input: Record<string, unknown> }
    ).input;
    expect(putInput).toMatchObject({
      Bucket: 'cashight-private-exports',
      Key: `exports/primary/${'a'.repeat(64)}/51ae8b2c-d0d4-4a49-87ee-662083d133f6.csv`,
      ContentType: 'text/csv; charset=utf-8',
      ServerSideEncryption: 'AES256',
      Metadata: { schemaVersion: '1', expiresAtEpoch: '1786277100' },
    });
    expect(presignGet).toHaveBeenCalledWith({
      bucket: 'cashight-private-exports',
      key: putInput.Key,
      expiresIn: 300,
    });
    expect(response).toEqual({
      downloadUrl: 'https://private.example/download',
      expiresAt: '2026-08-09T12:05:00.000Z',
      fileName: 'cashight-cost-explorer-2026-08-09.csv',
    });
    expect(response).not.toHaveProperty('bucket');
    expect(response).not.toHaveProperty('key');
  });
});
