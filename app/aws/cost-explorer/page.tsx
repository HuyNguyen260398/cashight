import { AwsDashboardPlaceholder } from '../components/aws-dashboard-placeholder';

export default function AwsCostExplorerPage() {
  return (
    <AwsDashboardPlaceholder
      eyebrow="AWS budget"
      title="AWS Cost Explorer"
      description="Explore deployment-account AWS costs without exposing AWS credentials to the browser."
    >
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Cost Explorer reporting arrives in Step 31.
      </p>
    </AwsDashboardPlaceholder>
  );
}
