import { BillingClient } from '@aws-sdk/client-billing';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';

export function createCostExplorerClients() {
  return {
    costExplorer: new CostExplorerClient({ region: 'us-east-1' }),
    billing: new BillingClient({ region: 'us-east-1' }),
  };
}
