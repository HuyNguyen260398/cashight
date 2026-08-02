// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_COLORS } from '@/lib/chart-colors';
import { categoryColor } from '@/lib/category-colors';

const item = {
  name: 'value',
  value: 1_229_000,
  color: '#ff0000',
  payload: { merchant: 'Shopee', category: 'E-commerce', value: 1_229_000 },
};

describe('ChartTooltip', () => {
  it('renders nothing when the chart is not being hovered', () => {
    const { container } = render(<ChartTooltip active={false} payload={[item]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when hovering with no payload', () => {
    // Recharts fires active=true with an empty payload between data points.
    const { container } = render(<ChartTooltip active payload={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('formats the value as VND', () => {
    render(<ChartTooltip active payload={[item]} label="Shopee" />);
    expect(screen.getByText(/1[.,]229[.,]000/)).toBeTruthy();
  });

  it('falls back to the axis label, then the series name, for the title', () => {
    render(<ChartTooltip active payload={[item]} label="15" />);
    expect(screen.getByText('15')).toBeTruthy();

    render(<ChartTooltip active payload={[{ ...item, name: 'Travel' }]} />);
    expect(screen.getByText('Travel')).toBeTruthy();
  });

  it('tints the value with colorOf, overriding the series colour', () => {
    // The series colour here is a gradient-url stand-in (#ff0000); the whole
    // point of colorOf is that the chart supplies the real hex instead.
    const { container } = render(
      <ChartTooltip
        active
        payload={[item]}
        colorOf={(i) => categoryColor(String(i.payload?.category ?? ''))}
      />,
    );
    const value = container.querySelector('[style*="color"]') as HTMLElement;
    expect(value.style.color).toBe('rgb(70, 95, 255)'); // E-commerce = #465fff
  });

  it("uses the series colour when the chart does not override it", () => {
    const { container } = render(<ChartTooltip active payload={[item]} />);
    const value = container.querySelector('[style*="color"]') as HTMLElement;
    expect(value.style.color).toBe('rgb(255, 0, 0)');
  });

  it('falls back to brand when neither a series colour nor colorOf is given', () => {
    const { container } = render(
      <ChartTooltip active payload={[{ ...item, color: undefined }]} />,
    );
    const value = container.querySelector('[style*="color"]') as HTMLElement;
    expect(CHART_COLORS.brand).toBe('#465fff');
    expect(value.style.color).toBe('rgb(70, 95, 255)');
  });

  it('shows the caption only when one is produced', () => {
    const { rerender } = render(
      <ChartTooltip
        active
        payload={[item]}
        captionOf={(i) => i.payload?.category as string}
      />,
    );
    expect(screen.getByText('E-commerce')).toBeTruthy();

    rerender(<ChartTooltip active payload={[item]} captionOf={() => undefined} />);
    expect(screen.queryByText('E-commerce')).toBeNull();
  });

  it('hugs its content rather than stretching to a fixed width', () => {
    const { container } = render(<ChartTooltip active payload={[item]} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('w-fit');
    expect(panel.className).toContain('whitespace-nowrap');
    expect(panel.className).toContain('rounded-xl');
  });
});
