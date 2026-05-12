import './WorkflowTable.css'

function getStatusBadge(status) {
  if (status === 'started') return 'badge-info'
  if (status === 'completed') return 'badge-success'
  if (status === 'failed') return 'badge-danger'
  if (status === 'timed_out') return 'badge-warning'
  if (status === 'cancelled') return 'badge-secondary'
  if (status === 'open') return 'badge-primary'
  return 'badge-default'
}

function formatStatusLabel(key) {
  if (key === 'timed_out') return 'Timed Out'
  if (key === 'cont_as_new') return 'ContAsNew'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function WorkflowTable({ windows }) {
  if (!windows || windows.length === 0) return null

  const columns = [
    { key: 'label', label: 'Time Window' },
    { key: 'started', label: 'Started', badge: 'started' },
    { key: 'completed', label: 'Completed', badge: 'completed' },
    { key: 'failed', label: 'Failed', badge: 'failed' },
    { key: 'timed_out', label: 'Timed Out', badge: 'timed_out' },
    { key: 'cancelled', label: 'Cancelled', badge: 'cancelled' },
    { key: 'open', label: 'Open', badge: 'open' },
  ]

  const rateKeys = [
    { key: 'started_rate', label: 'Started' },
    { key: 'completed_rate', label: 'Completed' },
    { key: 'failed_rate', label: 'Failed' },
    { key: 'timed_out_rate', label: 'Timed Out' },
    { key: 'cancelled_rate', label: 'Cancelled' },
    { key: 'open_rate', label: 'Open' },
  ]

  return (
    <div className="workflow-section">
      <div className="section-header">
        <h2 className="section-title">Workflow Rates by Time Window</h2>
        <span className="section-subtitle">Counts and rates per window</span>
      </div>
      <div className="table-container">
        <table className="workflow-table">
          <thead>
            <tr>
              <th className="col-window">Time Window</th>
              <th className="col-counts" colSpan={6}>Counts</th>
              <th className="col-rates" colSpan={6}>Rates</th>
            </tr>
            <tr>
              <th></th>
              {columns.slice(1).map((col) => (
                <th key={col.key} className="col-data">{col.label}</th>
              ))}
              {rateKeys.map((rk) => (
                <th key={rk.key} className="col-data">{rk.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {windows.map((win, idx) => (
              <tr key={idx}>
                <td className="cell-window">
                  <span className="window-label">{win.label}</span>
                  <span className="window-seconds">{win.seconds}s</span>
                </td>
                {columns.slice(1).map((col) => (
                  <td key={col.key} className="cell-data">
                    <span className={`badge ${getStatusBadge(col.badge)}`}>
                      {win[col.key] ?? '-'}
                    </span>
                  </td>
                ))}
                {rateKeys.map((rk) => (
                  <td key={rk.key} className="cell-rate">
                    {win[rk.key] ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default WorkflowTable
