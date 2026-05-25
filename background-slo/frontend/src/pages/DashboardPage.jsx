import SummaryCards from "../components/SummaryCards";
import WorkflowTable from "../components/WorkflowTable";
import TasklistLatency from "../components/TasklistLatency";
import AlertSetupModal from "./AlertSetupModal";

function DashboardPage({
  data,
  tasklistWindow,
  selectedTenantId,
  activeAlerts,
  onAlertSetup,
  alertModal,
  onCloseAlertModal,
  notificationsEnabled,
}) {
  return (
    <div className="dashboard-page">
      <SummaryCards
        rates30min={data.rates_30min}
        rates1hr={data.rates_1hr}
        rates1d={data.rates_1d}
        rates7d={data.rates_7d}
        rates30d={data.rates_30d}
        selectedRate={data.selected_rate}
        tasklistWindow={tasklistWindow}
        windows={data.windows}
        activeAlerts={activeAlerts}
        onAlertSetup={onAlertSetup}
        notificationsEnabled={notificationsEnabled}
      />
      <WorkflowTable windows={data.windows} />
      <TasklistLatency
        tasklists={data.tasklist_latency}
        tasklistWindow={tasklistWindow}
        activeAlerts={activeAlerts}
        onAlertSetup={onAlertSetup}
      />

      {alertModal && (
        <AlertSetupModal
          isOpen={true}
          onClose={onCloseAlertModal}
          tenantId={selectedTenantId}
          tileId={alertModal.tileId}
          tileLabel={alertModal.tileLabel}
          existingRule={null}
          onSaved={onCloseAlertModal}
        />
      )}
    </div>
  );
}

export default DashboardPage;
