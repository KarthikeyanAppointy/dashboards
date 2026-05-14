import SummaryCards from "../components/SummaryCards";
import WorkflowTable from "../components/WorkflowTable";
import TasklistLatency from "../components/TasklistLatency";

function DashboardPage({ data, tasklistWindow }) {
  return (
    <div className="dashboard-page">
      <SummaryCards
        rates30min={data.rates_30min}
        rates1hr={data.rates_1hr}
        rates1d={data.rates_1d}
        rates7d={data.rates_7d}
        rates30d={data.rates_30d}
        windows={data.windows}
      />
      <WorkflowTable windows={data.windows} />
      <TasklistLatency
        tasklists={data.tasklist_latency}
        tasklistWindow={tasklistWindow}
      />
    </div>
  );
}

export default DashboardPage;
