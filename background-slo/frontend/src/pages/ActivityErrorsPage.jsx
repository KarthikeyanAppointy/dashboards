import ActivityErrors from "../components/ActivityErrors";

function ActivityErrorsPage({
  data,
  activityStatusFilter,
  onActivityStatusFilterChange,
}) {
  return (
    <ActivityErrors
      activityErrors={data.activity_errors}
      liveFailureCount={data.total_failed}
      processedFailureCount={data.activity_errors_processed_count}
      pendingFailureCount={data.activity_errors_pending_count}
      hasPendingFailures={data.activity_errors_pending}
      statusFilter={activityStatusFilter}
      onStatusFilterChange={onActivityStatusFilterChange}
    />
  );
}

export default ActivityErrorsPage;
