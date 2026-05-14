import RecentFailures from "../components/RecentFailures";

function RecentFailuresPage({
  data,
  limit,
  onLimitChange,
  statusFilter,
  onStatusFilterChange,
  tasklistFilter,
  onTasklistFilterChange,
  availableTasklists,
  offset,
  onOffsetChange,
  totalFailed,
}) {
  return (
    <RecentFailures
      failures={data.recent_failed}
      limit={limit}
      onLimitChange={onLimitChange}
      statusFilter={statusFilter}
      onStatusFilterChange={onStatusFilterChange}
      tasklistFilter={tasklistFilter}
      onTasklistFilterChange={onTasklistFilterChange}
      availableTasklists={availableTasklists}
      offset={offset}
      onOffsetChange={onOffsetChange}
      totalFailed={totalFailed}
    />
  );
}

export default RecentFailuresPage;
