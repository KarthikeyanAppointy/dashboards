import P100LatencyByWorkflow from "../components/P100LatencyByWorkflow";

function P100LatencyPage({ data }) {
  return <P100LatencyByWorkflow data={data.p100_by_workflow} />;
}

export default P100LatencyPage;
