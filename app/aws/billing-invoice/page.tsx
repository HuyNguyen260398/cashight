import { AwsDashboardPlaceholder } from '../components/aws-dashboard-placeholder';

export default function AwsBillingInvoicePage() {
  return (
    <AwsDashboardPlaceholder
      eyebrow="AWS budget"
      title="AWS Billing Invoice"
      description="Review privacy-safe monthly AWS invoice summaries inside the Cashight workspace."
    >
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Billing invoice ingestion and charts arrive in Step 32.
      </p>
    </AwsDashboardPlaceholder>
  );
}
