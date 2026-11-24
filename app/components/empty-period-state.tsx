'use client';

import { useRouter } from 'next/navigation';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { periodLabel, type PeriodSpec } from '@/lib/period';
import type { BankCode } from '@/lib/banks';
import { shouldHandleClientSide } from '@/app/components/console/follow';

export function EmptyPeriodState({ spec, bank }: { spec: PeriodSpec; bank: BankCode }) {
  const router = useRouter();
  const latestHref = `/?bank=${bank}`;
  return (
    <Container>
      <Box textAlign="center" padding={{ vertical: 'xl' }}>
        <SpaceBetween size="s" alignItems="center">
          <Box variant="h2">No statements for {periodLabel(spec)}</Box>
          <Box color="text-body-secondary">
            There&apos;s no spending data for this period. Upload a statement, or jump back to your most recent data.
          </Box>
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="primary" href="#statement-upload">
              Upload statement
            </Button>
            <Button
              href={latestHref}
              onFollow={(event) => {
                if (!shouldHandleClientSide({ detail: event.detail })) return;
                event.preventDefault();
                router.push(latestHref);
              }}
            >
              Go to latest
            </Button>
          </SpaceBetween>
        </SpaceBetween>
      </Box>
    </Container>
  );
}
