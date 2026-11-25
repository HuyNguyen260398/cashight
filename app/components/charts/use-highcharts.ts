'use client';

import { useEffect, useState } from 'react';

type HighchartsModule = typeof import('highcharts');

/**
 * Loads Highcharts plus its accessibility module on the client only. The
 * module must be registered before any chart renders, otherwise
 * chart-components' screen-reader options do nothing and every chart is an
 * unlabelled image. Charts receive `null` until it
 * resolves and show their fallback meanwhile; this keeps Highcharts out of
 * the static-export prerender and out of the initial bundle.
 */
export function useHighcharts(): HighchartsModule | null {
  const [highcharts, setHighcharts] = useState<HighchartsModule | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const highchartsModule = await import('highcharts');
      // Highcharts 12 modules register themselves on the shared instance.
      await import('highcharts/modules/accessibility');
      if (active) setHighcharts((highchartsModule.default ?? highchartsModule) as HighchartsModule);
    })();
    return () => {
      active = false;
    };
  }, []);
  return highcharts;
}
