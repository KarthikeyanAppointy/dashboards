import ActivityErrors from "../components/ActivityErrors";

function ActivityErrorsPage({
  data,
  activityStatusFilter,
  onActivityStatusFilterChange,
  activityErrorDetailField,
  onActivityErrorDetailFieldChange,
}) {
  return (
    <ActivityErrors
      activityErrors={data.activity_errors}
      statusFilter={activityStatusFilter}
      onStatusFilterChange={onActivityStatusFilterChange}
      errorDetailField={activityErrorDetailField}
      onErrorDetailFieldChange={onActivityErrorDetailFieldChange}
    />
  );
}

export default ActivityErrorsPage;
