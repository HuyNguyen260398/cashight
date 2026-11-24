import type { ReactNode } from 'react';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';

export function InvoiceChartCard({
  title,
  description,
  ariaLabel,
  summary,
  empty,
  children,
}: {
  title: string;
  description: string;
  ariaLabel: string;
  summary: ReactNode;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Container header={<Header variant="h2" description={description}>{title}</Header>}>
      {empty ? (
        <Box textAlign="center" color="text-body-secondary" padding={{ vertical: 'xxl' }}>
          No {title.toLowerCase()} data
        </Box>
      ) : (
        <div role="img" aria-label={ariaLabel}>
          <div className="visually-hidden">{summary}</div>
          {children}
        </div>
      )}
    </Container>
  );
}
