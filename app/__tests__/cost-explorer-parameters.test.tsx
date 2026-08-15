// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CostExplorerReportRequest,
  SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBuilder } from '@/app/components/aws-cost-explorer/filter-builder';
import { ReportParameters } from '@/app/components/aws-cost-explorer/report-parameters';
import { SavedReports } from '@/app/components/aws-cost-explorer/saved-reports';

const API_BASE_URL = 'https://api.example.com';
const NOW = new Date('2026-08-10T08:00:00.000Z');
const REPORT_ID = '11111111-1111-4111-8111-111111111111';

const defaultRequest: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-02-01', end: '2026-08-10' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

const dimensionLabels = [
  'API operation',
  'Availability Zone',
  'Billing entity',
  'Charge type',
  'Instance type',
  'Legal entity',
  'Linked account',
  'Platform',
  'Purchase option',
  'Region',
  'Resource',
  'Service',
  'Tenancy',
  'Usage type',
  'Usage type group',
];

const mockApiFetch = vi.fn();

vi.mock('@/frontend/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/frontend/api/client')>()),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('@/frontend/auth/config', () => ({
  getPublicConfig: () => ({ apiBaseUrl: API_BASE_URL }),
}));

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderParameters(
  overrides: Partial<React.ComponentProps<typeof ReportParameters>> = {},
) {
  const onApply = vi.fn();
  const view = render(
    <ReportParameters
      initialRequest={defaultRequest}
      granularDataEnabled={false}
      now={NOW}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { ...view, onApply };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/aws/cost-explorer/');
  mockApiFetch.mockResolvedValue(response({ items: [], nextCursor: null }));
});

afterEach(cleanup);

describe('ReportParameters control coverage', () => {
  it('renders every approved report control and filter family', async () => {
    renderParameters();

    expect(screen.getByRole('heading', { name: 'Report parameters' })).toBeTruthy();
    const dateRange = screen.getByLabelText('Date range');
    for (const label of [
      'Current month',
      'Last 7 days',
      'Last 30 days',
      'Last 3 months',
      'Last 6 months',
      'Year to date',
      'Custom',
    ]) {
      expect(within(dateRange).getByRole('option', { name: label })).toBeTruthy();
    }
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByLabelText('End date')).toBeTruthy();

    const mode = screen.getByLabelText('Report mode');
    expect(within(mode).getByRole('option', { name: 'Standard' })).toBeTruthy();
    expect(
      (within(mode).getByRole('option', { name: 'Resource' }) as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    expect(within(mode).getByRole('option', { name: 'Comparison' })).toBeTruthy();
    expect(screen.getByLabelText('Billing view')).toBeTruthy();

    const metric = screen.getByLabelText('Metric');
    for (const label of [
      'Unblended cost',
      'Blended cost',
      'Amortized cost',
      'Net unblended cost',
      'Net amortized cost',
      'Usage quantity',
      'Normalized usage amount',
    ]) {
      expect(within(metric).getByRole('option', { name: label })).toBeTruthy();
    }
    expect(screen.getByLabelText('Granularity')).toBeTruthy();
    expect(screen.getByLabelText('Group 1 type')).toBeTruthy();
    expect(screen.getByLabelText('Group 1 key')).toBeTruthy();
    expect(screen.getByLabelText('Group 2 type')).toBeTruthy();
    expect(screen.getByLabelText('Group 2 key')).toBeTruthy();
    expect(screen.getByLabelText('Chart style')).toBeTruthy();
    expect(screen.getByLabelText('Show forecast')).toBeTruthy();
    expect(screen.getByLabelText('Show only untagged')).toBeTruthy();
    expect(screen.getByLabelText('Show only uncategorized')).toBeTruthy();

    fireEvent.change(mode, { target: { value: 'COMPARISON' } });
    expect(screen.getByLabelText('Comparison range')).toBeTruthy();
    expect(screen.getByLabelText('Comparison start date')).toBeTruthy();
    expect(screen.getByLabelText('Comparison end date')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    const category = screen.getByLabelText('Filter 1 category');
    expect(within(category).getByRole('option', { name: 'Dimension' })).toBeTruthy();
    expect(within(category).getByRole('option', { name: 'Tag' })).toBeTruthy();
    expect(within(category).getByRole('option', { name: 'Cost category' })).toBeTruthy();
    const dimension = screen.getByLabelText('Filter 1 dimension');
    for (const label of dimensionLabels) {
      expect(within(dimension).getByRole('option', { name: label })).toBeTruthy();
    }
  });

  it('keeps edits local until Apply validates and emits the complete request', async () => {
    const { onApply } = renderParameters();
    fireEvent.change(screen.getByLabelText('Metric'), {
      target: { value: 'AmortizedCost' },
    });
    fireEvent.change(screen.getByLabelText('Chart style'), {
      target: { value: 'LINE' },
    });

    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply report' }));

    expect(onApply).toHaveBeenCalledWith({
      ...defaultRequest,
      metric: 'AmortizedCost',
      chartStyle: 'LINE',
    });
    expect(window.location.search).toContain('metric=AmortizedCost');
    expect(window.location.search).toContain('chart=LINE');
  });

  it('derives consecutive closed calendar months for month-to-month comparison', () => {
    renderParameters({ granularDataEnabled: true });
    fireEvent.change(screen.getByLabelText('Report mode'), {
      target: { value: 'COMPARISON' },
    });
    fireEvent.change(screen.getByLabelText('Comparison range'), {
      target: { value: 'MONTH_TO_MONTH' },
    });

    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(
      '2026-07-01',
    );
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe(
      '2026-08-01',
    );
    expect(
      (screen.getByLabelText('Comparison start date') as HTMLInputElement).value,
    ).toBe('2026-06-01');
    expect(
      (screen.getByLabelText('Comparison end date') as HTMLInputElement).value,
    ).toBe('2026-07-01');
  });
});

describe('ReportParameters compatibility feedback', () => {
  it('disables grouped forecast with the domain explanation', () => {
    renderParameters({
      initialRequest: { ...defaultRequest, showForecast: true },
    });

    expect(
      (screen.getByLabelText('Show forecast') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Forecast values are unavailable for grouped reports.'),
    ).toBeTruthy();
  });

  it('explains disabled granular data and invalid resource service/date', () => {
    renderParameters({
      initialRequest: {
        ...defaultRequest,
        mode: 'RESOURCE',
        timePeriod: { start: '2026-07-01', end: '2026-08-10' },
        granularity: 'DAILY',
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      },
    });

    expect(
      screen.getByText('Granular Cost Explorer data is disabled by the deployment operator.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Resource reports must stay within the most recent 14 days.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Resource reports require SERVICE = Amazon Elastic Compute Cloud - Compute.',
      ),
    ).toBeTruthy();
  });

  it('explains resource comparison and normalized-usage caveats', () => {
    const first = renderParameters({
      initialRequest: {
        ...defaultRequest,
        mode: 'COMPARISON',
        comparisonTimePeriod: { start: '2025-12-01', end: '2026-02-01' },
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      },
    });
    expect(
      screen.getByText('Comparison reports do not support resource data'),
    ).toBeTruthy();

    first.unmount();
    renderParameters({
      initialRequest: {
        ...defaultRequest,
        groupBy: [],
        metric: 'NormalizedUsageAmount',
      },
      granularDataEnabled: true,
    });
    expect(
      screen.getByText(
        'NormalizedUsageAmount is meaningful only for supported normalized usage.',
      ),
    ).toBeTruthy();
  });
});

describe('FilterBuilder lazy values', () => {
  it('loads pages only after opening and preserves selections across debounced search', async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        response({
          items: [{ value: 'Alpha Compute' }, { value: 'Beta Database' }],
          nextCursor: 'next-page',
        }),
      )
      .mockResolvedValueOnce(
        response({ items: [{ value: 'Gamma Storage' }], nextCursor: null }),
      )
      .mockResolvedValueOnce(
        response({ items: [{ value: 'Data Warehouse' }], nextCursor: null }),
      );
    const onChange = vi.fn();
    render(
      <FilterBuilder
        value={undefined}
        timePeriod={defaultRequest.timePeriod}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(mockApiFetch).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Choose Service values' }),
    );
    await waitFor(() => expect(screen.getByLabelText('Alpha Compute')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('Alpha Compute'));
    await userEvent.click(screen.getByRole('button', { name: 'Load more values' }));
    await waitFor(() => expect(screen.getByLabelText('Gamma Storage')).toBeTruthy());

    const secondBody = JSON.parse(String(mockApiFetch.mock.calls[1][1].body));
    expect(secondBody.cursor).toBe('next-page');
    const search = screen.getByLabelText('Search Service values');
    await userEvent.type(search, 'data');
    await waitFor(
      () => expect(screen.getByLabelText('Data Warehouse')).toBeTruthy(),
      { timeout: 1_500 },
    );
    expect(screen.getByText('Selected: Alpha Compute')).toBeTruthy();
    const searchBody = JSON.parse(String(mockApiFetch.mock.calls[2][1].body));
    expect(searchBody.search).toBe('data');
  });

  it('emits AND across filter cards and OR within selected values', async () => {
    mockApiFetch.mockImplementation(async () =>
      response({
        items: [{ value: 'Compute' }, { value: 'Database' }],
        nextCursor: null,
      }),
    );
    const onChange = vi.fn();
    render(
      <FilterBuilder
        value={undefined}
        timePeriod={defaultRequest.timePeriod}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    fireEvent.change(screen.getByLabelText('Filter 2 category'), {
      target: { value: 'TAG' },
    });
    fireEvent.change(screen.getByLabelText('Filter 2 key'), {
      target: { value: 'Team' },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Choose Service values' }),
    );
    await waitFor(() => expect(screen.getByLabelText('Compute')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('Compute'));
    await userEvent.click(screen.getByLabelText('Database'));
    await userEvent.click(screen.getByRole('button', { name: 'Close Service values' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose Team values' }));
    await waitFor(() => expect(screen.getAllByLabelText('Compute')).toHaveLength(1));
    await userEvent.click(screen.getByLabelText('Compute'));

    expect(onChange).toHaveBeenLastCalledWith({
      And: [
        {
          Dimensions: {
            Key: 'SERVICE',
            Values: ['Compute', 'Database'],
            MatchOptions: ['EQUALS'],
          },
        },
        {
          Tags: {
            Key: 'Team',
            Values: ['Compute'],
            MatchOptions: ['EQUALS'],
          },
        },
      ],
    });
  });
});

describe('ReportParameters reset and sharing', () => {
  it('resets the draft and copies only a same-origin validated report URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { onApply } = renderParameters();
    fireEvent.change(screen.getByLabelText('Metric'), {
      target: { value: 'BlendedCost' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reset report' }));
    expect((screen.getByLabelText('Metric') as HTMLSelectElement).value).toBe(
      'UnblendedCost',
    );
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Copy report link' }));
    const copied = new URL(writeText.mock.calls[0][0]);
    expect(copied.origin).toBe(window.location.origin);
    expect(copied.pathname).toBe('/aws/cost-explorer/');
    expect(copied.searchParams.get('metric')).toBe('UnblendedCost');
    expect(copied.search).not.toMatch(/token|credential|roleArn|accountId/i);
  });
});

describe('SavedReports', () => {
  const reports: SavedCostReport[] = [
    {
      reportId: REPORT_ID,
      name: 'Monthly services',
      request: defaultRequest,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
  ];

  it('loads, saves, renames, and confirms deletion', async () => {
    const onLoad = vi.fn();
    const onSave = vi.fn().mockResolvedValue(reports[0]);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const activeRequest: CostExplorerReportRequest = {
      ...defaultRequest,
      metric: 'BlendedCost',
    };
    render(
      <SavedReports
        reports={reports}
        currentRequest={activeRequest}
        loading={false}
        error={null}
        onLoad={onLoad}
        onSave={onSave}
        onDelete={onDelete}
      />,
    );
    fireEvent.change(screen.getByLabelText('Saved report'), {
      target: { value: REPORT_ID },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Load report' }));
    expect(onLoad).toHaveBeenCalledWith(defaultRequest);

    const name = screen.getByLabelText('Report name');
    await userEvent.type(name, 'New report');
    await userEvent.click(screen.getByRole('button', { name: 'Save as new' }));
    expect(onSave).toHaveBeenCalledWith('New report', activeRequest, undefined);

    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed report');
    await userEvent.click(screen.getByRole('button', { name: 'Rename report' }));
    expect(onSave).toHaveBeenCalledWith('Renamed report', defaultRequest, REPORT_ID);

    await userEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete report' }));
    expect(onDelete).toHaveBeenCalledWith(REPORT_ID);
  });

  it('blocks case-insensitive duplicate names and renders loading/errors', async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SavedReports
        reports={reports}
        currentRequest={defaultRequest}
        loading={false}
        error={null}
        onLoad={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('Report name'), 'monthly SERVICES');
    await userEvent.click(screen.getByRole('button', { name: 'Save as new' }));
    expect(screen.getByText('A saved report already uses that name.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <SavedReports
        reports={[]}
        currentRequest={defaultRequest}
        loading
        error={{ message: 'Could not load reports' }}
        onLoad={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading saved reports…')).toBeTruthy();
    expect(screen.getByText('Could not load reports').getAttribute('role')).toBe(
      'alert',
    );
  });
});
