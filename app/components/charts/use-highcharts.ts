'use client';

import { useEffect, useState } from 'react';

type HighchartsModule = typeof import('highcharts');

/**
 * Loads Highcharts on the client only. Charts receive `null` until it
 * resolves and show their fallback meanwhile; this keeps Highcharts out of
 * the static-export prerender and out of the initial bundle.
 */
export function useHighcharts(): HighchartsModule | null {
  const [highcharts, setHighcharts] = useState<HighchartsModule | null>(null);
  useEffect(() => {
    let active = true;
    void import('highcharts').then((module) => {
      if (active) setHighcharts((module.default ?? module) as HighchartsModule);
    });
    return () => {
      active = false;
    };
  }, []);
  return highcharts;
}
