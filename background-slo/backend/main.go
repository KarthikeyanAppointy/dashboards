package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/lib/pq"
	"golang.org/x/oauth2/google"
)

// ============================================================
// Configuration (per-tenant, populated at request time)
// ============================================================

// Config holds the per-tenant configuration needed for ES queries.
type Config struct {
	ES          string
	Index       string
	DomainID    string
	DomainName  string
	ESApiKey    string
	AudienceURL string
}

// tenantESConfig builds ES query config from a tenant record.
func tenantESConfig(t *Tenant) Config {
	return Config{
		ES:          t.ESEndpoint,
		Index:       t.ESIndex,
		DomainID:    t.DomainID,
		DomainName:  t.DomainName,
		ESApiKey:    t.ESApiKey,
		AudienceURL: t.AudienceURL,
	}
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}

// ============================================================
// Tenant Model
// ============================================================

// Tenant represents a single tenant in the multi-tenant system.
type Tenant struct {
	ID              int       `json:"id"`
	Name            string    `json:"name"`
	DomainID        string    `json:"domain_id"`
	DomainName      string    `json:"domain_name"`
	ESEndpoint      string    `json:"es_endpoint"`
	ESIndex         string    `json:"es_index"`
	ESApiKey        string    `json:"es_api_key"`
	AudienceURL     string    `json:"audience_url"`
	NotifyHubURL    string    `json:"notifyhub_url"`
	NotifyHubAPIKey string    `json:"notifyhub_api_key"`
	CadenceWebURL   string    `json:"cadence_web_url"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AlertRule represents a single alert rule for a tenant.
type AlertRule struct {
	ID                  int        `json:"id"`
	TenantID            int        `json:"tenant_id"`
	Name                string     `json:"name"`
	Enabled             bool       `json:"enabled"`
	MetricType          string     `json:"metric_type"`
	ConditionType       string     `json:"condition_type"`
	Threshold           float64    `json:"threshold"`
	WindowSeconds       int        `json:"window_seconds"`
	NotificationChannel string     `json:"notification_channel"`
	NotificationTarget  string     `json:"notification_target"`
	NotifyHubTemplateID string     `json:"notifyhub_template_id"`
	SESRegion           string     `json:"ses_region"`
	TileID              string     `json:"tile_id"`
	AlertType           string     `json:"alert_type"`
	MessageTemplate     string     `json:"message_template"`
	CooldownSeconds     int        `json:"cooldown_seconds"`
	LastTriggeredAt     *time.Time `json:"last_triggered_at"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// CodefacPipeline stores a codefac pipeline configuration for a tenant.
type CodefacPipeline struct {
	ID              int        `json:"id"`
	TenantID        int        `json:"tenant_id"`
	Name            string     `json:"name"`
	PipelineName    string     `json:"pipeline_name"` // Codefac pipeline name configured in NotifyHub App Store
	MetricType      string     `json:"metric_type"`
	ConditionType   string     `json:"condition_type"`
	Threshold       float64    `json:"threshold"`
	PayloadTemplate string     `json:"payload_template"`
	CooldownSeconds int        `json:"cooldown_seconds"`
	Enabled         bool       `json:"enabled"`
	LastTriggeredAt *time.Time `json:"last_triggered_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// NotificationChannel stores per-channel recipient configuration for a tenant.
type NotificationChannel struct {
	ID         int       `json:"id"`
	TenantID   int       `json:"tenant_id"`
	Channel    string    `json:"channel"`    // "email", "sms", "slack"
	Scope      string    `json:"scope"`      // "alert" or "report"
	Recipients []string  `json:"recipients"` // email addresses, phone numbers, slack channel names
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// RBACEntry stores permissions for a user on a tenant.
type RBACEntry struct {
	ID        int    `json:"id"`
	UserEmail string `json:"user_email"`
	TenantID  int    `json:"tenant_id"`
	Role      string `json:"role"` // "admin" or "user"
	Persona   string `json:"persona"`
	// Permissions is a JSON array of sidebar sections the user can access.
	// Example: ["overview","failures","ses","pipeline-requests","notifications"]
	Permissions  []string   `json:"permissions"`
	LastActivity *time.Time `json:"last_activity"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type Report struct {
	ID              int        `json:"id"`
	TenantID        int        `json:"tenant_id"`
	Name            string     `json:"name"`
	Enabled         bool       `json:"enabled"`
	ReportType      string     `json:"report_type"`
	Frequency       string     `json:"frequency"`
	DayOfWeek       int        `json:"day_of_week"`
	DayOfMonth      int        `json:"day_of_month"`
	Channel         string     `json:"channel"`
	Recipients      []string   `json:"recipients"`
	SendTime        string     `json:"send_time"`
	Timezone        string     `json:"timezone"`
	MessageTemplate string     `json:"message_template"`
	Regions         []string   `json:"regions"`
	ClientName      string     `json:"client_name"`
	WorkflowTopN    int        `json:"workflow_top_n"`
	LastSentAt      *time.Time `json:"last_sent_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type AlertHistory struct {
	ID            int       `json:"id"`
	TenantID      int       `json:"tenant_id"`
	AlertRuleID   *int      `json:"alert_rule_id"`
	TileID        string    `json:"tile_id"`
	MetricType    string    `json:"metric_type"`
	MetricValue   float64   `json:"metric_value"`
	Threshold     float64   `json:"threshold"`
	ConditionType string    `json:"condition_type"`
	Channel       string    `json:"channel"`
	Recipient     string    `json:"recipient"`
	Status        string    `json:"status"`
	ErrorMessage  string    `json:"error_message"`
	WorkflowID    string    `json:"workflow_id"`
	RunID         string    `json:"run_id"`
	SentAt        time.Time `json:"sent_at"`
	CreatedAt     time.Time `json:"created_at"`
}

type WorkflowRCAView struct {
	HasRCA                bool       `json:"has_rca"`
	HasCustomerImpact     bool       `json:"has_customer_impact"`
	EventID               string     `json:"event_id"`
	RCATitle              string     `json:"rca_title"`
	RCASummary            string     `json:"rca_summary"`
	CustomerImpactSummary string     `json:"customer_impact_summary"`
	CustomerImpactDetails string     `json:"customer_impact_details"`
	CustomerImpactItems   []string   `json:"customer_impact_items"`
	RootCause             string     `json:"root_cause"`
	Remediation           string     `json:"remediation"`
	CurrentStatus         string     `json:"current_status"`
	OpenMRURL             string     `json:"open_mr_url"`
	OpenMRLabel           string     `json:"open_mr_label"`
	RawReport             string     `json:"raw_report"`
	RCAReceivedAt         *time.Time `json:"rca_received_at"`
}

type WorkflowRCAReport struct {
	ID                    int
	TenantID              int
	Source                string
	EventID               string
	WorkflowID            string
	RunID                 string
	WorkflowType          string
	Title                 string
	Summary               string
	CustomerImpactSummary string
	CustomerImpactDetails string
	CustomerImpactItems   []string
	RootCause             string
	Remediation           string
	CurrentStatus         string
	OpenMRURL             string
	OpenMRLabel           string
	RawReport             string
	RaisedAt              *time.Time
	WorkflowStartedAt     *time.Time
	FailedAt              *time.Time
	ReceivedAt            time.Time
	UpdatedAt             time.Time
}

type codefacRCAIngestRequest struct {
	TenantID            int      `json:"tenant_id"`
	Domain              string   `json:"domain"`
	DomainName          string   `json:"domain_name"`
	WorkflowID          string   `json:"workflow_id"`
	RunID               string   `json:"run_id"`
	WorkflowType        string   `json:"workflow_type"`
	EventID             string   `json:"event_id"`
	Title               string   `json:"title"`
	Summary             string   `json:"summary"`
	CustomerImpact      string   `json:"customer_impact"`
	CustomerImpactItems []string `json:"customer_impact_items"`
	RootCause           string   `json:"root_cause"`
	Remediation         string   `json:"remediation"`
	CurrentStatus       string   `json:"current_status"`
	OpenMRURL           string   `json:"open_mr_url"`
	OpenMRLabel         string   `json:"open_mr_label"`
	MRURL               string   `json:"mr_url"`
	MRLabel             string   `json:"mr_label"`
	PRURL               string   `json:"pr_url"`
	PRLabel             string   `json:"pr_label"`
	MergeRequestURL     string   `json:"merge_request_url"`
	MergeRequestLabel   string   `json:"merge_request_label"`
	PullRequestURL      string   `json:"pull_request_url"`
	PullRequestLabel    string   `json:"pull_request_label"`
	RawReport           string   `json:"raw_report"`
	RaisedAt            string   `json:"raised_at"`
	WorkflowStartedAt   string   `json:"workflow_started_at"`
	FailedAt            string   `json:"failed_at"`
	Source              string   `json:"source"`
}

// newUUIDv4 generates a UUID v4 string using crypto/rand.
func newUUIDv4() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Fallback - extremely unlikely
		return fmt.Sprintf("%x-%x-%x-%x-%x", time.Now().UnixNano(), time.Now().UnixNano()>>32, time.Now().UnixNano()>>16, time.Now().UnixNano(), time.Now().UnixNano())
	}
	// Set version 4
	b[6] = (b[6] & 0x0f) | 0x40
	// Set variant bits (RFC 4122)
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func alertRuleInCooldown(lastTriggeredAt *time.Time, cooldownSeconds int) bool {
	if cooldownSeconds <= 0 || lastTriggeredAt == nil {
		return false
	}
	return time.Since(*lastTriggeredAt) < time.Duration(cooldownSeconds)*time.Second
}

func workflowAlertAlreadySent(alertRuleID int, workflowID, runID string) bool {
	var exists int
	err := db.QueryRow(`
		SELECT 1 FROM alert_history
		WHERE alert_rule_id = $1 AND workflow_id = $2 AND run_id = $3 AND status = 'sent'
		LIMIT 1`, alertRuleID, workflowID, runID).Scan(&exists)
	return err == nil && exists == 1
}

// workflowHistoryStorageMode returns how {{workflow_history}} / {{history}} are resolved.
// WORKFLOW_HISTORY_STORAGE: auto (default), gcs, or inline.
//   - auto: upload to GCS when GCS_HISTORY_BUCKET is set, otherwise inline JSON
//   - gcs: always upload (requires GCS_HISTORY_BUCKET)
//   - inline: embed history JSON in the payload (no GCS)
func workflowHistoryStorageMode() string {
	mode := strings.ToLower(strings.TrimSpace(getEnv("WORKFLOW_HISTORY_STORAGE", "auto")))
	switch mode {
	case "gcs", "inline", "auto":
		return mode
	default:
		return "auto"
	}
}

func workflowHistoryUseGCS() bool {
	switch workflowHistoryStorageMode() {
	case "inline":
		return false
	case "gcs":
		return true
	default:
		return getEnv("GCS_HISTORY_BUCKET", "") != ""
	}
}

func substituteWorkflowHistoryPlaceholders(payloadStr string, tenant *Tenant, workflowID, runID string) string {
	needsHistory := strings.Contains(payloadStr, "{{history}}") ||
		strings.Contains(payloadStr, "{{workflow_history}}")
	if !needsHistory {
		return payloadStr
	}

	var historyData []byte
	var fetchErr error
	if tenant.CadenceWebURL == "" {
		fetchErr = fmt.Errorf("cadence_web_url not configured for this tenant")
	} else {
		histCtx, histCancel := context.WithTimeout(context.Background(), 90*time.Second)
		historyData, fetchErr = fetchWorkflowHistory(histCtx, tenant.CadenceWebURL, tenant.DomainName, workflowID, runID, "cluster0", tenant.AudienceURL)
		histCancel()
		if fetchErr != nil {
			log.Printf("ERROR: fetch workflow history: %v", fetchErr)
		}
	}

	errMsg := workflowHistoryFetchErrorMessage(tenant, fetchErr)
	if workflowHistoryUseGCS() {
		return substituteWorkflowHistoryGCS(payloadStr, tenant, workflowID, runID, historyData, errMsg)
	}
	return substituteWorkflowHistoryInline(payloadStr, historyData, errMsg)
}

func workflowHistoryFetchErrorMessage(tenant *Tenant, fetchErr error) string {
	if fetchErr == nil {
		return ""
	}
	if tenant.CadenceWebURL == "" {
		return "(cadence_web_url not configured for this tenant)"
	}
	return fmt.Sprintf("(history fetch failed: %v)", fetchErr)
}

func substituteWorkflowHistoryGCS(payloadStr string, tenant *Tenant, workflowID, runID string, historyData []byte, errMsg string) string {
	replacement := errMsg
	if errMsg == "" {
		objectName := fmt.Sprintf("%s/%s/%s_%s_history.json", tenant.DomainName, time.Now().Format("2006/01/02"), workflowID, runID)
		gcsURL, err := uploadToGCS(historyData, objectName)
		if err != nil {
			log.Printf("ERROR: upload history to GCS: %v", err)
			replacement = fmt.Sprintf("(history upload failed: %v)", err)
		} else {
			replacement = gcsURL
		}
	}
	return applyWorkflowHistoryReplacement(payloadStr, replacement)
}

func substituteWorkflowHistoryInline(payloadStr string, historyData []byte, errMsg string) string {
	var replacement interface{} = errMsg
	if errMsg == "" {
		var historyVal interface{}
		if err := json.Unmarshal(historyData, &historyVal); err != nil {
			return applyWorkflowHistoryReplacement(payloadStr, string(historyData))
		}
		replacement = historyVal
	}
	return applyWorkflowHistoryReplacement(payloadStr, replacement)
}

func applyWorkflowHistoryReplacement(payloadStr string, replacement interface{}) string {
	replacementStr := historyReplacementString(replacement)
	if injected, ok := injectWorkflowHistoryJSON(payloadStr, replacement); ok {
		return injected
	}
	payloadStr = strings.ReplaceAll(payloadStr, "{{history}}", replacementStr)
	payloadStr = strings.ReplaceAll(payloadStr, "{{workflow_history}}", replacementStr)
	return payloadStr
}

func historyReplacementString(replacement interface{}) string {
	switch v := replacement.(type) {
	case string:
		return v
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

// injectWorkflowHistoryJSON replaces {{workflow_history}} / {{history}} inside a JSON
// payload template (string URL, error text, or inline history object).
func injectWorkflowHistoryJSON(payloadStr string, replacement interface{}) (string, bool) {
	var root interface{}
	if err := json.Unmarshal([]byte(payloadStr), &root); err != nil {
		return "", false
	}

	newRoot, changed := replaceHistoryPlaceholders(root, replacement)
	if !changed {
		return "", false
	}
	out, err := json.Marshal(newRoot)
	if err != nil {
		return "", false
	}
	return string(out), true
}

func replaceHistoryPlaceholders(v interface{}, replacement interface{}) (interface{}, bool) {
	switch x := v.(type) {
	case string:
		if x == "{{workflow_history}}" || x == "{{history}}" {
			return replacement, true
		}
		return v, false
	case map[string]interface{}:
		changed := false
		out := make(map[string]interface{}, len(x))
		for k, val := range x {
			newVal, c := replaceHistoryPlaceholders(val, replacement)
			out[k] = newVal
			if c {
				changed = true
			}
		}
		return out, changed
	case []interface{}:
		changed := false
		out := make([]interface{}, len(x))
		for i, val := range x {
			newVal, c := replaceHistoryPlaceholders(val, replacement)
			out[i] = newVal
			if c {
				changed = true
			}
		}
		return out, changed
	default:
		return v, false
	}
}

func applyCodefacWorkflowPayload(
	payloadStr string,
	pipe CodefacPipeline,
	tenant *Tenant,
	ruleName string,
	wf RecentWorkflow,
) string {
	if ruleName == "" {
		ruleName = pipe.Name
	}
	payloadStr = strings.ReplaceAll(payloadStr, "{{rule_name}}", ruleName)
	payloadStr = strings.ReplaceAll(payloadStr, "{{pipeline_name}}", pipe.Name)
	payloadStr = strings.ReplaceAll(payloadStr, "{{domain}}", tenant.DomainName)
	payloadStr = strings.ReplaceAll(payloadStr, "{{domain_id}}", tenant.DomainID)
	payloadStr = strings.ReplaceAll(payloadStr, "{{tenant_id}}", fmt.Sprintf("%d", tenant.ID))
	payloadStr = strings.ReplaceAll(payloadStr, "{{workflow_id}}", wf.WorkflowID)
	payloadStr = strings.ReplaceAll(payloadStr, "{{run_id}}", wf.RunID)
	payloadStr = strings.ReplaceAll(payloadStr, "{{workflow_type}}", wf.WorkflowType)
	payloadStr = strings.ReplaceAll(payloadStr, "{{workflow-type}}", wf.WorkflowType)
	payloadStr = strings.ReplaceAll(payloadStr, "{{tasklist}}", wf.TaskList)
	payloadStr = strings.ReplaceAll(payloadStr, "{{status}}", wf.Status)
	payloadStr = strings.ReplaceAll(payloadStr, "{{close_time}}", wf.CloseTime)
	payloadStr = strings.ReplaceAll(payloadStr, "{{idempotency_key}}", newUUIDv4())
	return substituteWorkflowHistoryPlaceholders(payloadStr, tenant, wf.WorkflowID, wf.RunID)
}

const (
	pipelineWorkflowFailureStatusPending          = "pending"
	pipelineWorkflowFailureStatusProcessing       = "processing"
	pipelineWorkflowFailureStatusTriggered        = "triggered"
	pipelineWorkflowFailureStatusSkippedDuplicate = "skipped_duplicate"
	pipelineWorkflowFailureStatusSkippedInflight  = "skipped_inflight"
	pipelineWorkflowFailureStatusSkippedCooldown  = "skipped_cooldown"
	pipelineWorkflowFailureStatusTriggerFailed    = "trigger_failed"
	pipelineWorkflowFailureStaleAfter             = 5 * time.Minute
)

type pipelineWorkflowErrorDetails struct {
	Text      string
	Signature string
}

type pipelineWorkflowFailureRow struct {
	WorkflowRCAView
	ID                  int        `json:"id"`
	TenantID            int        `json:"tenant_id"`
	PipelineID          int        `json:"pipeline_id"`
	PipelineName        string     `json:"pipeline_name"`
	WorkflowID          string     `json:"workflow_id"`
	RunID               string     `json:"run_id"`
	WorkflowType        string     `json:"workflow_type"`
	SourceStatus        string     `json:"source_status"`
	Status              string     `json:"status"`
	ErrorSignature      string     `json:"error_signature"`
	ErrorText           string     `json:"error_text"`
	MatchedFailureID    *int       `json:"matched_failure_id"`
	MatchedWorkflowID   string     `json:"matched_workflow_id"`
	MatchedRunID        string     `json:"matched_run_id"`
	MatchedTriggeredAt  *time.Time `json:"matched_triggered_at"`
	DeliveryStatus      string     `json:"delivery_status"`
	ErrorMessage        string     `json:"error_message"`
	TriggerAttempts     int        `json:"trigger_attempts"`
	FirstSeenAt         time.Time  `json:"first_seen_at"`
	LastSeenAt          time.Time  `json:"last_seen_at"`
	ProcessingStartedAt *time.Time `json:"processing_started_at"`
	TriggeredAt         *time.Time `json:"triggered_at"`
	ProcessedAt         *time.Time `json:"processed_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type manualPipelineRequestRow struct {
	WorkflowRCAView
	ID             int       `json:"id"`
	TenantID       int       `json:"tenant_id"`
	PipelineName   string    `json:"pipeline_name"`
	Recipient      string    `json:"recipient"`
	Status         string    `json:"status"`
	DeliveryStatus string    `json:"delivery_status"`
	ErrorMessage   string    `json:"error_message"`
	WorkflowID     string    `json:"workflow_id"`
	RunID          string    `json:"run_id"`
	WorkflowType   string    `json:"workflow_type"`
	SourceStatus   string    `json:"source_status"`
	ErrorText      string    `json:"error_text"`
	SentAt         time.Time `json:"sent_at"`
}

type scanner interface {
	Scan(dest ...any) error
}

func normalizeWorkflowErrorSignature(errorText string) string {
	trimmed := strings.TrimSpace(strings.ToLower(errorText))
	if trimmed == "" {
		return ""
	}
	trimmed = strings.Join(strings.Fields(trimmed), " ")
	sum := sha256.Sum256([]byte(trimmed))
	return hex.EncodeToString(sum[:])
}

func loadStoredWorkflowFailureText(ctx context.Context, tenantID int, workflowID string, runID string) (string, error) {
	var reason string
	var message string
	var details string
	var fetchError string
	var closeStatus int
	err := db.QueryRowContext(ctx, `
		SELECT
			COALESCE(NULLIF(failure_reason, ''), '') AS failure_reason,
			COALESCE(NULLIF(failure_message, ''), '') AS failure_message,
			COALESCE(NULLIF(failure_details, ''), '') AS failure_details,
			COALESCE(NULLIF(history_fetch_error, ''), '') AS history_fetch_error,
			close_status
		FROM workflow_failures
		WHERE tenant_id = $1 AND workflow_id = $2 AND run_id = $3`,
		tenantID, workflowID, runID,
	).Scan(&reason, &message, &details, &fetchError, &closeStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return storedActivityErrorText(reason, message, details, fetchError, workflowCloseStatusLabel(closeStatus)), nil
}

func loadRecentStoredWorkflowFailures(ctx context.Context, tenantID int, limit int, window time.Duration) ([]RecentWorkflow, error) {
	if tenantID <= 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if window <= 0 {
		window = time.Hour
	}

	fromNanos := time.Now().Add(-window).UnixNano()
	rows, err := db.QueryContext(ctx, `
		SELECT
			workflow_id,
			run_id,
			workflow_type,
			tasklist,
			close_status,
			close_time_ns,
			COALESCE(NULLIF(failure_reason, ''), '')
		FROM workflow_failures
		WHERE tenant_id = $1
		  AND close_status IN (1, 5)
		  AND close_time_ns >= $2
		ORDER BY close_time_ns DESC
		LIMIT $3`,
		tenantID, fromNanos, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("load recent stored workflow failures: %w", err)
	}
	defer rows.Close()

	results := make([]RecentWorkflow, 0, limit)
	for rows.Next() {
		var wf RecentWorkflow
		var closeStatus int
		var closeTimeNs int64
		if err := rows.Scan(
			&wf.WorkflowID,
			&wf.RunID,
			&wf.WorkflowType,
			&wf.TaskList,
			&closeStatus,
			&closeTimeNs,
			&wf.FailureReason,
		); err != nil {
			return nil, fmt.Errorf("scan recent stored workflow failure: %w", err)
		}
		wf.Status = workflowCloseStatusLabel(closeStatus)
		wf.CloseTime = time.Unix(0, closeTimeNs).UTC().Format(time.RFC3339)
		results = append(results, wf)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent stored workflow failures: %w", err)
	}
	return results, nil
}

func workflowFailureErrorDetails(ctx context.Context, tenantID int, wf RecentWorkflow) pipelineWorkflowErrorDetails {
	signatureText := ""
	storedText, err := loadStoredWorkflowFailureText(ctx, tenantID, wf.WorkflowID, wf.RunID)
	if err != nil {
		log.Printf("WARN: pipeline dedupe: load stored failure text tenant=%d workflow=%s run=%s: %v", tenantID, wf.WorkflowID, wf.RunID, err)
	} else {
		signatureText = strings.TrimSpace(storedText)
	}
	if signatureText == "" {
		signatureText = strings.TrimSpace(wf.FailureReason)
	}

	displayText := signatureText
	if displayText == "" {
		displayText = strings.TrimSpace(wf.Status)
	}
	if displayText == "" {
		displayText = "Unknown error"
	}

	return pipelineWorkflowErrorDetails{
		Text:      displayText,
		Signature: normalizeWorkflowErrorSignature(signatureText),
	}
}

func EnsurePipelineWorkflowFailuresTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS pipeline_workflow_failures (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		pipeline_id INTEGER NOT NULL REFERENCES codefac_pipelines(id) ON DELETE CASCADE,
		pipeline_name TEXT NOT NULL DEFAULT '',
		workflow_id TEXT NOT NULL DEFAULT '',
		run_id TEXT NOT NULL DEFAULT '',
		workflow_type TEXT NOT NULL DEFAULT '',
		source_status TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		error_signature TEXT NOT NULL DEFAULT '',
		error_text TEXT NOT NULL DEFAULT '',
		matched_failure_id INTEGER REFERENCES pipeline_workflow_failures(id) ON DELETE SET NULL,
		matched_workflow_id TEXT NOT NULL DEFAULT '',
		matched_run_id TEXT NOT NULL DEFAULT '',
		matched_triggered_at TIMESTAMPTZ,
		delivery_status TEXT NOT NULL DEFAULT '',
		error_message TEXT NOT NULL DEFAULT '',
		trigger_attempts INTEGER NOT NULL DEFAULT 0,
		first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		processing_started_at TIMESTAMPTZ,
		triggered_at TIMESTAMPTZ,
		processed_at TIMESTAMPTZ,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE (tenant_id, pipeline_id, workflow_id, run_id)
	);`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("create pipeline_workflow_failures table: %w", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_pipeline_workflow_failures_tenant_updated ON pipeline_workflow_failures (tenant_id, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pipeline_workflow_failures_lookup ON pipeline_workflow_failures (tenant_id, pipeline_id, workflow_type, error_signature, status)`,
		`CREATE INDEX IF NOT EXISTS idx_pipeline_workflow_failures_status ON pipeline_workflow_failures (tenant_id, status, updated_at DESC)`,
	}
	for _, stmt := range indexes {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("WARN: could not ensure pipeline_workflow_failures index %q: %v", stmt, err)
		}
	}
	return nil
}

func EnsureWorkflowRCATable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS workflow_rca_reports (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		source TEXT NOT NULL DEFAULT 'codefac',
		event_id TEXT NOT NULL DEFAULT '',
		workflow_id TEXT NOT NULL DEFAULT '',
		run_id TEXT NOT NULL DEFAULT '',
		workflow_type TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		summary TEXT NOT NULL DEFAULT '',
		customer_impact_summary TEXT NOT NULL DEFAULT '',
		customer_impact_details TEXT NOT NULL DEFAULT '',
		customer_impact_items TEXT[] NOT NULL DEFAULT '{}',
		root_cause TEXT NOT NULL DEFAULT '',
		remediation TEXT NOT NULL DEFAULT '',
		current_status TEXT NOT NULL DEFAULT '',
		open_mr_url TEXT NOT NULL DEFAULT '',
		open_mr_label TEXT NOT NULL DEFAULT '',
		raw_report TEXT NOT NULL DEFAULT '',
		raised_at TIMESTAMPTZ,
		workflow_started_at TIMESTAMPTZ,
		failed_at TIMESTAMPTZ,
		received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE (tenant_id, run_id)
	);`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("create workflow_rca_reports table: %w", err)
	}
	db.Exec(`ALTER TABLE workflow_rca_reports DROP CONSTRAINT IF EXISTS workflow_rca_reports_tenant_id_workflow_id_run_id_key`)
	db.Exec(`ALTER TABLE workflow_rca_reports ADD CONSTRAINT workflow_rca_reports_tenant_id_run_id_key UNIQUE (tenant_id, run_id)`)

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_workflow_rca_reports_tenant_received ON workflow_rca_reports (tenant_id, received_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_workflow_rca_reports_tenant_workflow ON workflow_rca_reports (tenant_id, workflow_id, run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_workflow_rca_reports_tenant_event ON workflow_rca_reports (tenant_id, event_id)`,
	}
	for _, stmt := range indexes {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("WARN: could not ensure workflow_rca_reports index %q: %v", stmt, err)
		}
	}
	return nil
}

func workflowRCAHasCustomerImpact(view WorkflowRCAView) bool {
	if len(view.CustomerImpactItems) > 0 {
		return true
	}
	if strings.TrimSpace(view.CustomerImpactSummary) != "" {
		return true
	}
	return strings.TrimSpace(view.CustomerImpactDetails) != ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func trimTextPreview(value string, max int) string {
	text := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if text == "" || max <= 0 || len(text) <= max {
		return text
	}
	if max == 1 {
		return text[:1]
	}
	return text[:max-1] + "…"
}

func normalizeRBACPersona(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "qa":
		return "qa"
	case "ceam":
		return "ceam"
	default:
		return "developer"
	}
}

func normalizeImpactItems(items []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(items))
	for _, item := range items {
		cleaned := strings.TrimSpace(strings.TrimLeft(item, "-*• \t"))
		if cleaned == "" {
			continue
		}
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		out = append(out, cleaned)
	}
	return out
}

func summarizeImpact(items []string, details string) string {
	if len(items) > 0 {
		return trimTextPreview(items[0], 180)
	}
	return trimTextPreview(details, 180)
}

func buildWorkflowRCAView(record WorkflowRCAReport) WorkflowRCAView {
	view := WorkflowRCAView{
		HasRCA:                true,
		EventID:               strings.TrimSpace(record.EventID),
		RCATitle:              strings.TrimSpace(record.Title),
		RCASummary:            strings.TrimSpace(record.Summary),
		CustomerImpactSummary: strings.TrimSpace(record.CustomerImpactSummary),
		CustomerImpactDetails: strings.TrimSpace(record.CustomerImpactDetails),
		CustomerImpactItems:   normalizeImpactItems(record.CustomerImpactItems),
		RootCause:             strings.TrimSpace(record.RootCause),
		Remediation:           strings.TrimSpace(record.Remediation),
		CurrentStatus:         strings.TrimSpace(record.CurrentStatus),
		OpenMRURL:             strings.TrimSpace(record.OpenMRURL),
		OpenMRLabel:           strings.TrimSpace(record.OpenMRLabel),
		RawReport:             strings.TrimSpace(record.RawReport),
		RCAReceivedAt:         &record.ReceivedAt,
	}
	if view.CustomerImpactSummary == "" {
		view.CustomerImpactSummary = summarizeImpact(view.CustomerImpactItems, view.CustomerImpactDetails)
	}
	view.HasCustomerImpact = workflowRCAHasCustomerImpact(view)
	return view
}

type workflowRunRef struct {
	WorkflowID string
	RunID      string
}

func loadWorkflowRCALookup(tenantID int, refs []workflowRunRef) map[string]WorkflowRCAView {
	if tenantID <= 0 || len(refs) == 0 {
		return nil
	}

	args := []any{tenantID}
	values := make([]string, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		workflowID := strings.TrimSpace(ref.WorkflowID)
		runID := strings.TrimSpace(ref.RunID)
		if workflowID == "" || runID == "" {
			continue
		}
		key := recentWorkflowLookupKey(workflowID, runID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		args = append(args, workflowID, runID)
		values = append(values, fmt.Sprintf("($%d, $%d)", len(args)-1, len(args)))
	}
	if len(values) == 0 {
		return nil
	}

	query := fmt.Sprintf(`
		SELECT
			refs.workflow_id,
			refs.run_id,
			wr.event_id,
			wr.title,
			wr.summary,
			wr.customer_impact_summary,
			wr.customer_impact_details,
			wr.customer_impact_items,
			wr.root_cause,
			wr.remediation,
			wr.current_status,
			wr.open_mr_url,
			wr.open_mr_label,
			wr.raw_report,
			wr.received_at
		FROM workflow_rca_reports wr
		JOIN (VALUES %s) AS refs(workflow_id, run_id)
		  ON wr.run_id = refs.run_id
		WHERE wr.tenant_id = $1`,
		strings.Join(values, ", "),
	)

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("WARN: workflow rca lookup tenant %d: %v", tenantID, err)
		return nil
	}
	defer rows.Close()

	out := make(map[string]WorkflowRCAView, len(values))
	for rows.Next() {
		var workflowID string
		var runID string
		var record WorkflowRCAReport
		record.TenantID = tenantID
		if err := rows.Scan(
			&workflowID,
			&runID,
			&record.EventID,
			&record.Title,
			&record.Summary,
			&record.CustomerImpactSummary,
			&record.CustomerImpactDetails,
			pq.Array(&record.CustomerImpactItems),
			&record.RootCause,
			&record.Remediation,
			&record.CurrentStatus,
			&record.OpenMRURL,
			&record.OpenMRLabel,
			&record.RawReport,
			&record.ReceivedAt,
		); err != nil {
			log.Printf("WARN: workflow rca scan tenant %d: %v", tenantID, err)
			continue
		}
		out[recentWorkflowLookupKey(workflowID, runID)] = buildWorkflowRCAView(record)
	}
	if err := rows.Err(); err != nil {
		log.Printf("WARN: workflow rca iteration tenant %d: %v", tenantID, err)
	}
	return out
}

func attachWorkflowRCAToRecentFailures(tenantID int, recent []RecentWorkflow) {
	refs := make([]workflowRunRef, 0, len(recent))
	for _, item := range recent {
		refs = append(refs, workflowRunRef{WorkflowID: item.WorkflowID, RunID: item.RunID})
	}
	lookup := loadWorkflowRCALookup(tenantID, refs)
	if len(lookup) == 0 {
		return
	}
	for i := range recent {
		if view, ok := lookup[recentWorkflowLookupKey(recent[i].WorkflowID, recent[i].RunID)]; ok {
			recent[i].WorkflowRCAView = view
		}
	}
}

func attachWorkflowRCAToPipelineFailures(tenantID int, items []pipelineWorkflowFailureRow) {
	refs := make([]workflowRunRef, 0, len(items))
	for _, item := range items {
		refs = append(refs, workflowRunRef{WorkflowID: item.WorkflowID, RunID: item.RunID})
	}
	lookup := loadWorkflowRCALookup(tenantID, refs)
	if len(lookup) == 0 {
		return
	}
	for i := range items {
		if view, ok := lookup[recentWorkflowLookupKey(items[i].WorkflowID, items[i].RunID)]; ok {
			items[i].WorkflowRCAView = view
		}
	}
}

func attachWorkflowRCAToManualPipelineRequests(tenantID int, items []manualPipelineRequestRow) {
	refs := make([]workflowRunRef, 0, len(items))
	for _, item := range items {
		refs = append(refs, workflowRunRef{WorkflowID: item.WorkflowID, RunID: item.RunID})
	}
	lookup := loadWorkflowRCALookup(tenantID, refs)
	if len(lookup) == 0 {
		return
	}
	for i := range items {
		if view, ok := lookup[recentWorkflowLookupKey(items[i].WorkflowID, items[i].RunID)]; ok {
			items[i].WorkflowRCAView = view
		}
	}
}

func scanPipelineWorkflowFailure(row scanner) (*pipelineWorkflowFailureRow, error) {
	var item pipelineWorkflowFailureRow
	var matchedFailureID sql.NullInt64
	var matchedTriggeredAt sql.NullTime
	var processingStartedAt sql.NullTime
	var triggeredAt sql.NullTime
	var processedAt sql.NullTime

	err := row.Scan(
		&item.ID,
		&item.TenantID,
		&item.PipelineID,
		&item.PipelineName,
		&item.WorkflowID,
		&item.RunID,
		&item.WorkflowType,
		&item.SourceStatus,
		&item.Status,
		&item.ErrorSignature,
		&item.ErrorText,
		&matchedFailureID,
		&item.MatchedWorkflowID,
		&item.MatchedRunID,
		&matchedTriggeredAt,
		&item.DeliveryStatus,
		&item.ErrorMessage,
		&item.TriggerAttempts,
		&item.FirstSeenAt,
		&item.LastSeenAt,
		&processingStartedAt,
		&triggeredAt,
		&processedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if matchedFailureID.Valid {
		value := int(matchedFailureID.Int64)
		item.MatchedFailureID = &value
	}
	if matchedTriggeredAt.Valid {
		value := matchedTriggeredAt.Time
		item.MatchedTriggeredAt = &value
	}
	if processingStartedAt.Valid {
		value := processingStartedAt.Time
		item.ProcessingStartedAt = &value
	}
	if triggeredAt.Valid {
		value := triggeredAt.Time
		item.TriggeredAt = &value
	}
	if processedAt.Valid {
		value := processedAt.Time
		item.ProcessedAt = &value
	}
	return &item, nil
}

func pipelineWorkflowFailureColumns() string {
	return `
		id, tenant_id, pipeline_id, pipeline_name, workflow_id, run_id, workflow_type,
		source_status, status, error_signature, error_text, matched_failure_id,
		matched_workflow_id, matched_run_id, matched_triggered_at, delivery_status,
		error_message, trigger_attempts, first_seen_at, last_seen_at,
		processing_started_at, triggered_at, processed_at, updated_at`
}

func upsertPipelineWorkflowFailure(
	ctx context.Context,
	tenantID int,
	pipe CodefacPipeline,
	wf RecentWorkflow,
	errorDetails pipelineWorkflowErrorDetails,
) (*pipelineWorkflowFailureRow, error) {
	row := db.QueryRowContext(ctx, `
		INSERT INTO pipeline_workflow_failures (
			tenant_id, pipeline_id, pipeline_name, workflow_id, run_id, workflow_type,
			source_status, status, error_signature, error_text, delivery_status,
			first_seen_at, last_seen_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', NOW(), NOW(), NOW())
		ON CONFLICT (tenant_id, pipeline_id, workflow_id, run_id) DO UPDATE
		SET
			pipeline_name = EXCLUDED.pipeline_name,
			workflow_type = EXCLUDED.workflow_type,
			source_status = EXCLUDED.source_status,
			error_signature = CASE
				WHEN EXCLUDED.error_signature <> '' THEN EXCLUDED.error_signature
				ELSE pipeline_workflow_failures.error_signature
			END,
			error_text = CASE
				WHEN EXCLUDED.error_text <> '' THEN EXCLUDED.error_text
				ELSE pipeline_workflow_failures.error_text
			END,
			last_seen_at = NOW(),
			updated_at = NOW()
		RETURNING `+pipelineWorkflowFailureColumns(),
		tenantID,
		pipe.ID,
		pipe.Name,
		wf.WorkflowID,
		wf.RunID,
		wf.WorkflowType,
		wf.Status,
		pipelineWorkflowFailureStatusPending,
		errorDetails.Signature,
		errorDetails.Text,
	)
	return scanPipelineWorkflowFailure(row)
}

func pipelineWorkflowFailureIsFinal(status string) bool {
	return status == pipelineWorkflowFailureStatusTriggered || status == pipelineWorkflowFailureStatusSkippedDuplicate
}

func findBlockingPipelineWorkflowFailure(
	ctx context.Context,
	current *pipelineWorkflowFailureRow,
) (*pipelineWorkflowFailureRow, error) {
	if current == nil || current.ErrorSignature == "" {
		return nil, nil
	}

	for {
		row := db.QueryRowContext(ctx, `
			SELECT `+pipelineWorkflowFailureColumns()+`
			FROM pipeline_workflow_failures
			WHERE tenant_id = $1
			  AND pipeline_id = $2
			  AND workflow_type = $3
			  AND error_signature = $4
			  AND id <> $5
			  AND status IN ($6, $7)
			ORDER BY
			  CASE status
				WHEN $6 THEN 0
				WHEN $7 THEN 1
				ELSE 2
			  END,
			  COALESCE(triggered_at, processing_started_at, updated_at) ASC,
			  id ASC
			LIMIT 1`,
			current.TenantID,
			current.PipelineID,
			current.WorkflowType,
			current.ErrorSignature,
			current.ID,
			pipelineWorkflowFailureStatusTriggered,
			pipelineWorkflowFailureStatusProcessing,
		)
		blocking, err := scanPipelineWorkflowFailure(row)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if blocking.Status != pipelineWorkflowFailureStatusProcessing ||
			blocking.ProcessingStartedAt == nil ||
			time.Since(blocking.ProcessingStartedAt.UTC()) <= pipelineWorkflowFailureStaleAfter {
			return blocking, nil
		}
		if err := expireStalePipelineWorkflowFailure(ctx, blocking); err != nil {
			return nil, err
		}
	}
}

func expireStalePipelineWorkflowFailure(ctx context.Context, row *pipelineWorkflowFailureRow) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			delivery_status = 'failed',
			error_message = $3,
			processing_started_at = NULL,
			processed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
		  AND status = $4`,
		row.ID,
		pipelineWorkflowFailureStatusTriggerFailed,
		"processing lease expired before pipeline delivery completed",
		pipelineWorkflowFailureStatusProcessing,
	)
	return err
}

func markPipelineWorkflowFailureFromHistory(ctx context.Context, row *pipelineWorkflowFailureRow) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			delivery_status = 'sent',
			error_message = '',
			matched_failure_id = NULL,
			matched_workflow_id = '',
			matched_run_id = '',
			matched_triggered_at = NULL,
			processing_started_at = NULL,
			triggered_at = COALESCE(triggered_at, NOW()),
			processed_at = COALESCE(processed_at, NOW()),
			updated_at = NOW()
		WHERE id = $1`,
		row.ID,
		pipelineWorkflowFailureStatusTriggered,
	)
	return err
}

func markPipelineWorkflowFailureCooldown(
	ctx context.Context,
	row *pipelineWorkflowFailureRow,
	lastTriggeredAt *time.Time,
) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	message := "pipeline cooldown active"
	if lastTriggeredAt != nil {
		message = fmt.Sprintf("pipeline cooldown active after %s", lastTriggeredAt.UTC().Format(time.RFC3339))
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			delivery_status = 'skipped',
			error_message = $3,
			matched_failure_id = NULL,
			matched_workflow_id = '',
			matched_run_id = '',
			matched_triggered_at = NULL,
			processing_started_at = NULL,
			processed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1`,
		row.ID,
		pipelineWorkflowFailureStatusSkippedCooldown,
		message,
	)
	return err
}

func markPipelineWorkflowFailureSkipped(
	ctx context.Context,
	row *pipelineWorkflowFailureRow,
	status string,
	matched *pipelineWorkflowFailureRow,
) error {
	if row == nil || row.ID <= 0 {
		return nil
	}

	var matchedFailureID any = nil
	matchedWorkflowID := ""
	matchedRunID := ""
	var matchedTriggeredAt any = nil
	errorMessage := ""
	if matched != nil {
		matchedFailureID = matched.ID
		matchedWorkflowID = matched.WorkflowID
		matchedRunID = matched.RunID
		if matched.TriggeredAt != nil {
			matchedTriggeredAt = matched.TriggeredAt
		}
		if status == pipelineWorkflowFailureStatusSkippedDuplicate {
			errorMessage = "same workflow type and error already triggered earlier"
		}
		if status == pipelineWorkflowFailureStatusSkippedInflight {
			errorMessage = "same workflow type and error is already being processed"
		}
	}

	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			matched_failure_id = $3,
			matched_workflow_id = $4,
			matched_run_id = $5,
			matched_triggered_at = $6,
			delivery_status = 'skipped',
			error_message = $7,
			processing_started_at = NULL,
			processed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1`,
		row.ID,
		status,
		matchedFailureID,
		matchedWorkflowID,
		matchedRunID,
		matchedTriggeredAt,
		errorMessage,
	)
	return err
}

func markPipelineWorkflowFailureProcessing(
	ctx context.Context,
	row *pipelineWorkflowFailureRow,
	errorDetails pipelineWorkflowErrorDetails,
) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			error_signature = $3,
			error_text = $4,
			matched_failure_id = NULL,
			matched_workflow_id = '',
			matched_run_id = '',
			matched_triggered_at = NULL,
			delivery_status = 'pending',
			error_message = '',
			trigger_attempts = trigger_attempts + 1,
			processing_started_at = NOW(),
			processed_at = NULL,
			updated_at = NOW()
		WHERE id = $1`,
		row.ID,
		pipelineWorkflowFailureStatusProcessing,
		errorDetails.Signature,
		errorDetails.Text,
	)
	return err
}

func markPipelineWorkflowFailureTriggered(
	ctx context.Context,
	row *pipelineWorkflowFailureRow,
	now time.Time,
) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			delivery_status = 'sent',
			error_message = '',
			processing_started_at = NULL,
			triggered_at = $3,
			processed_at = $3,
			updated_at = $3
		WHERE id = $1`,
		row.ID,
		pipelineWorkflowFailureStatusTriggered,
		now,
	)
	return err
}

func markPipelineWorkflowFailureFailed(
	ctx context.Context,
	row *pipelineWorkflowFailureRow,
	errorMessage string,
	now time.Time,
) error {
	if row == nil || row.ID <= 0 {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE pipeline_workflow_failures
		SET
			status = $2,
			delivery_status = 'failed',
			error_message = $3,
			processing_started_at = NULL,
			processed_at = $4,
			updated_at = $4
		WHERE id = $1`,
		row.ID,
		pipelineWorkflowFailureStatusTriggerFailed,
		errorMessage,
		now,
	)
	return err
}

func pipelineWorkflowFailuresHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}

	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	limit := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	source := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("source")))
	if source == "manual" {
		rows, err := db.Query(`
			SELECT
				ah.id,
				ah.tenant_id,
				COALESCE(NULLIF(cp.name, ''), NULLIF(ah.recipient, ''), 'Manual pipeline') AS pipeline_name,
				ah.recipient,
				ah.status,
				ah.status AS delivery_status,
				ah.error_message,
				ah.workflow_id,
				ah.run_id,
				COALESCE(NULLIF(wf.workflow_type, ''), '') AS workflow_type,
				CASE
					WHEN wf.close_status = 1 THEN 'Failed'
					WHEN wf.close_status = 5 THEN 'TimedOut'
					ELSE ''
				END AS source_status,
				COALESCE(NULLIF(wf.failure_reason, ''), '') AS failure_reason,
				COALESCE(NULLIF(wf.failure_message, ''), '') AS failure_message,
				COALESCE(NULLIF(wf.failure_details, ''), '') AS failure_details,
				COALESCE(NULLIF(wf.history_fetch_error, ''), '') AS history_fetch_error,
				COALESCE(wf.close_status, 0) AS close_status,
				ah.sent_at
			FROM alert_history ah
			LEFT JOIN codefac_pipelines cp
				ON cp.tenant_id = ah.tenant_id
			   AND cp.pipeline_name = ah.recipient
			LEFT JOIN workflow_failures wf
				ON wf.tenant_id = ah.tenant_id
			   AND wf.workflow_id = ah.workflow_id
			   AND wf.run_id = ah.run_id
			WHERE ah.tenant_id = $1
			  AND ah.channel = 'pipeline'
			  AND ah.metric_type = 'workflow_failure'
			  AND ah.alert_rule_id IS NULL
			ORDER BY ah.sent_at DESC, ah.id DESC
			LIMIT $2 OFFSET $3`,
			tenantID, limit, offset,
		)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("list manual pipeline requests: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		results := make([]manualPipelineRequestRow, 0)
		for rows.Next() {
			var item manualPipelineRequestRow
			var reason string
			var message string
			var details string
			var fetchError string
			var closeStatus int
			if err := rows.Scan(
				&item.ID,
				&item.TenantID,
				&item.PipelineName,
				&item.Recipient,
				&item.Status,
				&item.DeliveryStatus,
				&item.ErrorMessage,
				&item.WorkflowID,
				&item.RunID,
				&item.WorkflowType,
				&item.SourceStatus,
				&reason,
				&message,
				&details,
				&fetchError,
				&closeStatus,
				&item.SentAt,
			); err != nil {
				writeJSONError(w, fmt.Sprintf("scan manual pipeline request: %v", err), http.StatusInternalServerError)
				return
			}
			item.ErrorText = storedActivityErrorText(reason, message, details, fetchError, workflowCloseStatusLabel(closeStatus))
			results = append(results, item)
		}
		if err := rows.Err(); err != nil {
			writeJSONError(w, fmt.Sprintf("iterate manual pipeline requests: %v", err), http.StatusInternalServerError)
			return
		}
		attachWorkflowRCAToManualPipelineRequests(tenantID, results)

		writeJSON(w, map[string]any{
			"results": results,
			"limit":   limit,
			"offset":  offset,
			"source":  "manual",
		}, http.StatusOK)
		return
	}

	rows, err := db.Query(`
		SELECT `+pipelineWorkflowFailureColumns()+`
		FROM pipeline_workflow_failures
		WHERE tenant_id = $1
		ORDER BY COALESCE(processed_at, updated_at) DESC, id DESC
		LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("list pipeline workflow failures: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	results := make([]pipelineWorkflowFailureRow, 0)
	for rows.Next() {
		item, err := scanPipelineWorkflowFailure(rows)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("scan pipeline workflow failure: %v", err), http.StatusInternalServerError)
			return
		}
		results = append(results, *item)
	}
	if err := rows.Err(); err != nil {
		writeJSONError(w, fmt.Sprintf("iterate pipeline workflow failures: %v", err), http.StatusInternalServerError)
		return
	}
	attachWorkflowRCAToPipelineFailures(tenantID, results)

	writeJSON(w, map[string]any{
		"results": results,
		"limit":   limit,
		"offset":  offset,
		"source":  "es",
	}, http.StatusOK)
}

// EnsureAlertsTable creates the alert_rules table if it doesn't exist.
func EnsureAlertsTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS alert_rules (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		enabled BOOLEAN NOT NULL DEFAULT true,
		metric_type TEXT NOT NULL,
		condition_type TEXT NOT NULL,
		threshold DOUBLE PRECISION NOT NULL,
		window_seconds INTEGER NOT NULL DEFAULT 3600,
		notification_channel TEXT NOT NULL DEFAULT 'email',
		notification_target TEXT NOT NULL DEFAULT '',
		notifyhub_template_id TEXT NOT NULL DEFAULT '',
		last_triggered_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create alert_rules table: %w", err)
	}

	// Ensure columns added in later migrations
	if _, err := db.Exec(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS message_template TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add message_template column: %v", err)
	}

	return nil
}

func EnsureCodefacPipelinesTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS codefac_pipelines (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		pipeline_name TEXT NOT NULL,
		metric_type TEXT NOT NULL,
		condition_type TEXT NOT NULL,
		threshold DOUBLE PRECISION NOT NULL,
		payload_template TEXT NOT NULL DEFAULT '{}',
		enabled BOOLEAN NOT NULL DEFAULT true,
				last_triggered_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create codefac_pipelines table: %w", err)
	}
	return nil
}

func EnsureNotificationChannelsTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS notification_channels (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		channel TEXT NOT NULL,
		scope TEXT NOT NULL DEFAULT 'alert',
		recipients TEXT[] NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE(tenant_id, channel, scope)
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create notification_channels table: %w", err)
	}
	return nil
}

func EnsureReportsTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS reports (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		enabled BOOLEAN NOT NULL DEFAULT true,
		report_type TEXT NOT NULL DEFAULT 'slo_summary',
		frequency TEXT NOT NULL DEFAULT 'daily',
		day_of_week INTEGER NOT NULL DEFAULT 0,
		day_of_month INTEGER NOT NULL DEFAULT 1,
		channel TEXT NOT NULL DEFAULT 'email',
		recipients TEXT[] NOT NULL DEFAULT '{}',
		send_time TEXT NOT NULL DEFAULT '08:00',
		timezone TEXT NOT NULL DEFAULT 'UTC',
		last_sent_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create reports table: %w", err)
	}

	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS message_template TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add message_template column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT '{}'`); err != nil {
		log.Printf("WARN: could not add regions column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add client_name column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS workflow_top_n INTEGER NOT NULL DEFAULT 10`); err != nil {
		log.Printf("WARN: could not add workflow_top_n column: %v", err)
	}
	return nil
}

func EnsureAlertHistoryTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS alert_history (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		alert_rule_id INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
		tile_id TEXT NOT NULL DEFAULT '',
		metric_type TEXT NOT NULL DEFAULT '',
		metric_value DOUBLE PRECISION DEFAULT 0,
		threshold DOUBLE PRECISION DEFAULT 0,
		condition_type TEXT NOT NULL DEFAULT '',
		channel TEXT NOT NULL DEFAULT '',
		recipient TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'sent',
		error_message TEXT NOT NULL DEFAULT '',
		sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create alert_history table: %w", err)
	}

	// Ensure columns added in later migrations
	if _, err := db.Exec(`ALTER TABLE alert_history ADD COLUMN IF NOT EXISTS workflow_id TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add workflow_id column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE alert_history ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add run_id column: %v", err)
	}

	return nil
}

func EnsureWorkflowFailuresTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS workflow_failures (
		id SERIAL PRIMARY KEY,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		workflow_id TEXT NOT NULL,
		run_id TEXT NOT NULL,
		workflow_type TEXT NOT NULL DEFAULT '',
		tasklist TEXT NOT NULL DEFAULT '',
		close_status INTEGER NOT NULL DEFAULT 0,
		close_time_ns BIGINT NOT NULL DEFAULT 0,
		failure_reason TEXT NOT NULL DEFAULT '',
		failure_message TEXT NOT NULL DEFAULT '',
		failure_details TEXT NOT NULL DEFAULT '',
		history_fetch_error TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE (tenant_id, workflow_id, run_id)
	);`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("create workflow_failures table: %w", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_workflow_failures_tenant_close_time ON workflow_failures (tenant_id, close_time_ns DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_workflow_failures_tenant_workflow_type ON workflow_failures (tenant_id, workflow_type)`,
		`CREATE INDEX IF NOT EXISTS idx_workflow_failures_tenant_status ON workflow_failures (tenant_id, close_status)`,
	}
	for _, stmt := range indexes {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("WARN: could not ensure workflow_failures index %q: %v", stmt, err)
		}
	}

	return nil
}

func EnsureRBACTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS rbac (
		id SERIAL PRIMARY KEY,
		user_email TEXT NOT NULL,
		tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
		role TEXT NOT NULL DEFAULT 'user',
		permissions TEXT[] NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE(user_email, tenant_id)
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create rbac table: %w", err)
	}
	if _, err := db.Exec(`ALTER TABLE rbac ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ`); err != nil {
		log.Printf("WARN: could not add last_activity column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE rbac ADD COLUMN IF NOT EXISTS persona TEXT NOT NULL DEFAULT 'developer'`); err != nil {
		log.Printf("WARN: could not add persona column: %v", err)
	}
	return nil
}

// SESCloudWatchConfig holds the AWS region for CloudWatch SES metric queries.
// Credentials are resolved from the environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).
type SESCloudWatchConfig struct {
	Region        string
	ConfigSetName string
}

// TenantStore provides database operations for tenants.
type TenantStore struct {
	DB *sql.DB
}

// List returns all tenants.
func (s *TenantStore) List() ([]Tenant, error) {
	rows, err := s.DB.Query(
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url, created_at, updated_at
		 FROM tenants ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	defer rows.Close()

	var tenants []Tenant
	for rows.Next() {
		var t Tenant
		if err := rows.Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.AudienceURL, &t.NotifyHubURL, &t.NotifyHubAPIKey, &t.CadenceWebURL, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan tenant: %w", err)
		}
		tenants = append(tenants, t)
	}
	return tenants, rows.Err()
}

// GetByID returns a single tenant by ID.
func (s *TenantStore) GetByID(id int) (*Tenant, error) {
	var t Tenant
	err := s.DB.QueryRow(
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url, created_at, updated_at
		 FROM tenants WHERE id = $1`, id).
		Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.AudienceURL, &t.NotifyHubURL, &t.NotifyHubAPIKey, &t.CadenceWebURL, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tenant %d: %w", id, err)
	}
	return &t, nil
}

// Create inserts a new tenant and returns it.
func (s *TenantStore) Create(name, domainID, domainName, esEndpoint, esIndex, esApiKey, audienceURL, notifyhubURL, notifyhubAPIKey, cadenceWebURL string) (*Tenant, error) {
	var t Tenant
	err := s.DB.QueryRow(
		`INSERT INTO tenants (name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url, created_at, updated_at`,
		name, domainID, domainName, esEndpoint, esIndex, esApiKey, audienceURL, notifyhubURL, notifyhubAPIKey, cadenceWebURL).
		Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.AudienceURL, &t.NotifyHubURL, &t.NotifyHubAPIKey, &t.CadenceWebURL, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create tenant: %w", err)
	}
	return &t, nil
}

// Delete removes a tenant by ID.
func (s *TenantStore) Delete(id int) error {
	res, err := s.DB.Exec(`DELETE FROM tenants WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete tenant %d: %w", id, err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("tenant %d not found", id)
	}
	return nil
}

// Update modifies an existing tenant.
func (s *TenantStore) Update(id int, name, domainID, domainName, esEndpoint, esIndex, esApiKey, audienceURL, notifyhubURL, notifyhubAPIKey, cadenceWebURL string) (*Tenant, error) {
	var t Tenant
	err := s.DB.QueryRow(
		`UPDATE tenants SET name=$1, domain_id=$2, domain_name=$3, es_endpoint=$4, es_index=$5, es_api_key=$6, audience_url=$7, notifyhub_url=$8, notifyhub_api_key=$9, cadence_web_url=$10, updated_at=NOW()
		 WHERE id=$11
		 RETURNING id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url, created_at, updated_at`,
		name, domainID, domainName, esEndpoint, esIndex, esApiKey, audienceURL, notifyhubURL, notifyhubAPIKey, cadenceWebURL, id).
		Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.AudienceURL, &t.NotifyHubURL, &t.NotifyHubAPIKey, &t.CadenceWebURL, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("tenant %d not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("update tenant %d: %w", id, err)
	}
	return &t, nil
}

// SeedDefault creates or updates a default tenant from environment variables.
// If the tenants table is empty, it creates a new tenant.
// If the first tenant exists but has an empty domain_id, it updates it with env var values.
// This handles the case where the backend was previously started without DEFAULT_* env vars,
// creating a stub tenant with no domain_id.
func (s *TenantStore) SeedDefault() error {
	name := getEnv("DEFAULT_TENANT_NAME", "Default")
	domainID := getEnv("DEFAULT_DOMAIN_ID", "")
	domainName := getEnv("DEFAULT_DOMAIN_NAME", "unknown")
	esEndpoint := getEnv("DEFAULT_ES", "http://localhost:9000")
	esIndex := getEnv("DEFAULT_INDEX", "cadence-visibility")
	esApiKey := getEnv("DEFAULT_ES_API_KEY", "")
	cadenceWebURL := getEnv("DEFAULT_CADENCE_WEB_URL", "")

	// Check if any tenant exists
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM tenants`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check tenant count: %w", err)
	}

	if count == 0 {
		// Table is empty — create default tenant
		tenant, err := s.Create(name, domainID, domainName, esEndpoint, esIndex, esApiKey, "", "", "", cadenceWebURL)
		if err != nil {
			return fmt.Errorf("seed default tenant: %w", err)
		}
		log.Printf("Seeded default tenant: id=%d name=%q", tenant.ID, tenant.Name)
		return nil
	}

	// Check if the first tenant has an empty domain_id and update it
	var firstTenant Tenant
	err = s.DB.QueryRow(
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url FROM tenants ORDER BY id ASC LIMIT 1`).
		Scan(&firstTenant.ID, &firstTenant.Name, &firstTenant.DomainID, &firstTenant.DomainName,
			&firstTenant.ESEndpoint, &firstTenant.ESIndex, &firstTenant.ESApiKey, &firstTenant.AudienceURL)
	if err != nil {
		return fmt.Errorf("check first tenant: %w", err)
	}

	// Only update if domain_id is empty (stub tenant from previous run without env vars)
	if firstTenant.DomainID == "" && domainID != "" {
		_, err := s.DB.Exec(
			`UPDATE tenants SET name=$1, domain_id=$2, domain_name=$3, es_endpoint=$4, es_index=$5, es_api_key=$6, cadence_web_url = CASE WHEN COALESCE(cadence_web_url, '') = '' AND $7 <> '' THEN $7 ELSE cadence_web_url END, updated_at=NOW() WHERE id=$8`,
			name, domainID, domainName, esEndpoint, esIndex, esApiKey, cadenceWebURL, firstTenant.ID)
		if err != nil {
			return fmt.Errorf("update stub tenant %d: %w", firstTenant.ID, err)
		}
		log.Printf("Updated stub tenant id=%d with env defaults: name=%q domain=%q", firstTenant.ID, name, domainName)
	}

	if cadenceWebURL != "" {
		if _, err := s.DB.Exec(
			`UPDATE tenants SET cadence_web_url = $1, updated_at = NOW()
			 WHERE id = $2 AND COALESCE(cadence_web_url, '') = ''`,
			cadenceWebURL, firstTenant.ID,
		); err != nil {
			log.Printf("WARN: could not seed cadence_web_url for tenant %d: %v", firstTenant.ID, err)
		}
	}

	// If domain is still empty after the update attempt, that means DEFAULT_DOMAIN_ID is also empty
	if domainID == "" && firstTenant.DomainID == "" {
		log.Printf("WARN: DEFAULT_DOMAIN_ID is not set — tenant %q has no domain filter, showing ALL domains!", firstTenant.Name)
	}

	return nil
}

// EnsureTable creates the tenants table if it doesn't exist.
func EnsureTable(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS tenants (
		id SERIAL PRIMARY KEY,
		name TEXT NOT NULL,
		domain_id TEXT NOT NULL DEFAULT '',
		domain_name TEXT NOT NULL DEFAULT '',
		es_endpoint TEXT NOT NULL DEFAULT 'http://localhost:9000',
		es_index TEXT NOT NULL DEFAULT 'cadence-visibility',
		es_api_key TEXT NOT NULL DEFAULT '',
		audience_url TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("create tenants table: %w", err)
	}
	return nil
}

// ============================================================
// Auth
// ============================================================

// session holds the data for one authenticated browser session.
type session struct {
	Email   string
	Name    string
	Picture string
	Expiry  time.Time
}

// sessions is the in-memory store: token → session.
var sessions sync.Map

// ============================================================
// Data Cache (periodically refreshed from ES & CloudWatch)
// ============================================================

type dashboardCacheEntry struct {
	mu          sync.RWMutex
	Data        *APIResponse
	TotalFailed int
	UpdatedAt   time.Time
}

type sesCacheEntry struct {
	mu        sync.RWMutex
	Data      *SESMetricsResponse
	UpdatedAt time.Time
}

// gcpTokenEntry caches a GCP identity token with its expiry.
type gcpTokenEntry struct {
	mu        sync.RWMutex
	Token     string
	ExpiresAt time.Time
}

type workflowFailureEnrichmentJob struct {
	Tenant   Tenant
	Hit      esHit
	FetchKey string
}

var (
	dashboardCache         sync.Map // key: tenantID (int) -> *dashboardCacheEntry
	sesCache               sync.Map // key: "tenantID:region" (string) -> *sesCacheEntry
	gcpTokenCache          sync.Map // key: audienceURL (string) -> *gcpTokenEntry
	notifiedFailures       sync.Map // key: "tenantID:ruleID:workflowID:runID" -> timestamp (avoids re-sending same failure)
	triggeredRules         sync.Map // key: "tenantID:ruleID" -> bool (tracks if a threshold rule already fired for the current breach episode)
	workflowFailureFetches sync.Map // key: "tenantID:workflowID:runID" -> struct{}{} (avoids concurrent duplicate history fetches)
	workflowFailureQueue   chan workflowFailureEnrichmentJob
)

// generateToken returns a 32-byte cryptographically-random URL-safe token.
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// googleTokenInfo mirrors the fields we care about from Google's tokeninfo endpoint.
type googleTokenInfo struct {
	Sub              string `json:"sub"`
	Email            string `json:"email"`
	EmailVerified    string `json:"email_verified"`
	Name             string `json:"name"`
	Picture          string `json:"picture"`
	HD               string `json:"hd"` // hosted domain (set for Workspace accounts)
	Aud              string `json:"aud"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

const googleOAuthClientIDSuffix = ".apps.googleusercontent.com"

// sanitizeGoogleClientID trims a value and strips junk accidentally glued on by a
// broken shell line continuation, e.g. "...com"ADMIN_KEY=admin@123
func sanitizeGoogleClientID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, googleOAuthClientIDSuffix); idx >= 0 {
		clean := raw[:idx+len(googleOAuthClientIDSuffix)]
		if clean != raw {
			log.Printf(
				"WARN: GOOGLE_CLIENT_ID had extra characters %q after the client id; "+
					"put each VAR=value on its own line (blank line after \\) when using shell line continuation",
				raw[len(clean):],
			)
		}
		return clean
	}
	return raw
}

// allowedGoogleClientIDs returns OAuth client IDs from GOOGLE_CLIENT_ID and/or
// comma-separated GOOGLE_CLIENT_IDS. Empty means audience check is skipped.
func allowedGoogleClientIDs() []string {
	var ids []string
	seen := make(map[string]struct{})
	for _, key := range []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_IDS"} {
		raw := getEnv(key, "")
		if raw == "" {
			continue
		}
		for _, part := range strings.Split(raw, ",") {
			id := sanitizeGoogleClientID(part)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	return ids
}

func googleTokenAudienceAllowed(aud string) bool {
	allowed := allowedGoogleClientIDs()
	if len(allowed) == 0 {
		return true
	}
	aud = strings.TrimSpace(aud)
	for _, id := range allowed {
		if aud == id {
			return true
		}
	}
	return false
}

// authVerifyHandler handles POST /api/auth/verify.
// It validates the Google credential, enforces the @appointy.com domain,
// and returns a session token.
func authVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Credential string `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Credential == "" {
		writeJSONError(w, "credential is required", http.StatusBadRequest)
		return
	}

	// Verify the ID token with Google's tokeninfo endpoint.
	resp, err := http.Get("https://oauth2.googleapis.com/tokeninfo?id_token=" + req.Credential)
	if err != nil {
		writeJSONError(w, "failed to reach Google tokeninfo", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	var info googleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		writeJSONError(w, "failed to parse token info", http.StatusInternalServerError)
		return
	}
	if info.Error != "" {
		writeJSONError(w, "invalid Google token: "+info.Error, http.StatusUnauthorized)
		return
	}

	// Optionally verify the audience matches a configured OAuth client ID.
	if !googleTokenAudienceAllowed(info.Aud) {
		expected := strings.Join(allowedGoogleClientIDs(), ", ")
		writeJSONError(w, fmt.Sprintf(
			"token audience mismatch: got %q, expected %s (must match VITE_GOOGLE_CLIENT_ID on the frontend)",
			strings.TrimSpace(info.Aud), expected,
		), http.StatusUnauthorized)
		return
	}

	// Enforce @appointy.com domain (opt out via APPONTY_ONLY_LOGIN=false).
	if getEnv("APPONTY_ONLY_LOGIN", "true") == "true" {
		if !strings.HasSuffix(info.Email, "@appointy.com") && info.HD != "appointy.com" {
			writeJSONError(w, "access restricted to @appointy.com accounts", http.StatusForbidden)
			return
		}
	}

	token, err := generateToken()
	if err != nil {
		writeJSONError(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	sessions.Store(token, session{
		Email:   info.Email,
		Name:    info.Name,
		Picture: info.Picture,
		Expiry:  time.Now().Add(24 * time.Hour),
	})

	// Track last activity for this user across all tenants
	db.Exec(`UPDATE rbac SET last_activity = NOW() WHERE user_email = $1`, info.Email)

	writeJSON(w, map[string]string{
		"token":   token,
		"email":   info.Email,
		"name":    info.Name,
		"picture": info.Picture,
	}, http.StatusOK)
}

// authMeHandler handles GET /api/auth/me — returns the current user or 401.
func authMeHandler(w http.ResponseWriter, r *http.Request) {
	token := extractBearerToken(r)
	if token == "" {
		logAuthFailure(r, "missing or invalid bearer token")
		writeJSONError(w, "unauthorized: missing or invalid bearer token", http.StatusUnauthorized)
		return
	}
	val, ok := sessions.Load(token)
	if !ok {
		logAuthFailure(r, fmt.Sprintf("session not found (token prefix=%s…)", tokenPrefix(token)))
		writeJSONError(w, "unauthorized: session not found", http.StatusUnauthorized)
		return
	}
	s := val.(session)
	if time.Now().After(s.Expiry) {
		sessions.Delete(token)
		logAuthFailure(r, fmt.Sprintf("session expired for %s", s.Email))
		writeJSONError(w, "session expired", http.StatusUnauthorized)
		return
	}
	writeJSON(w, map[string]string{
		"email":   s.Email,
		"name":    s.Name,
		"picture": s.Picture,
	}, http.StatusOK)
}

// extractBearerToken pulls the token out of "Authorization: Bearer <token>".
func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	if token == "" || token == "null" || token == "undefined" {
		return ""
	}
	return token
}

func logAuthFailure(r *http.Request, reason string) {
	log.Printf("AUTH FAIL: %s %s — %s (remote=%s)", r.Method, r.URL.Path, reason, r.RemoteAddr)
}

// requireAuth wraps a handler and returns 401 if the request has no valid session.
func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token := extractBearerToken(r)
		if token == "" {
			reason := "missing or invalid bearer token"
			if authHeader != "" {
				reason = fmt.Sprintf("invalid authorization header (got %q)", authHeader)
			}
			logAuthFailure(r, reason)
			writeJSONError(w, "unauthorized: "+reason, http.StatusUnauthorized)
			return
		}
		val, ok := sessions.Load(token)
		if !ok {
			logAuthFailure(r, fmt.Sprintf("session not found (token prefix=%s…)", tokenPrefix(token)))
			writeJSONError(w, "unauthorized: session not found", http.StatusUnauthorized)
			return
		}
		if s := val.(session); time.Now().After(s.Expiry) {
			sessions.Delete(token)
			logAuthFailure(r, fmt.Sprintf("session expired for %s (expired at %s)", s.Email, s.Expiry.Format(time.RFC3339)))
			writeJSONError(w, "session expired", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func tokenPrefix(token string) string {
	if len(token) <= 8 {
		return token
	}
	return token[:8]
}

func sessionEmailFromRequest(r *http.Request) string {
	token := extractBearerToken(r)
	if token == "" {
		return ""
	}
	val, ok := sessions.Load(token)
	if !ok {
		return ""
	}
	return val.(session).Email
}

// requirePermission checks that the authenticated user has the required permission for this tenant.
func requirePermission(permission string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// First, require authentication
			token := extractBearerToken(r)
			if token == "" {
				logAuthFailure(r, "missing or invalid bearer token (requirePermission)")
				writeJSONError(w, "unauthorized: missing or invalid bearer token", http.StatusUnauthorized)
				return
			}
			val, ok := sessions.Load(token)
			if !ok {
				logAuthFailure(r, fmt.Sprintf("session not found (requirePermission, token prefix=%s…)", tokenPrefix(token)))
				writeJSONError(w, "unauthorized: session not found", http.StatusUnauthorized)
				return
			}
			s := val.(session)

			// Get tenant_id from query
			tenantIDStr := r.URL.Query().Get("tenant_id")
			if tenantIDStr == "" {
				writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
				return
			}
			var tenantID int
			if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
				writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
				return
			}

			// Check RBAC for this user + tenant
			var role string
			var perms []string
			err := db.QueryRow(`SELECT role, permissions FROM rbac WHERE user_email = $1 AND tenant_id = $2`,
				s.Email, tenantID).Scan(&role, pq.Array(&perms))
			if err == sql.ErrNoRows {
				writeJSONError(w, "forbidden: no access to this tenant", http.StatusForbidden)
				return
			}
			if err != nil {
				log.Printf("ERROR: check rbac: %v", err)
				writeJSONError(w, "internal error", http.StatusInternalServerError)
				return
			}

			// Admin has access to everything
			if role == "admin" {
				next(w, r)
				return
			}

			// Check if user has the required permission
			hasPermission := false
			for _, p := range perms {
				if p == permission {
					hasPermission = true
					break
				}
			}
			if !hasPermission {
				writeJSONError(w, "forbidden: insufficient permissions", http.StatusForbidden)
				return
			}

			next(w, r)
		}
	}
}

// getUserEmailFromRequest extracts the authenticated user's email from the request's Bearer token.
func getUserEmailFromRequest(r *http.Request) string {
	token := extractBearerToken(r)
	if token == "" {
		return ""
	}
	val, ok := sessions.Load(token)
	if !ok {
		return ""
	}
	s := val.(session)
	return s.Email
}

// getUserEmail extracts the authenticated user's email from the request's Bearer token.
func getUserEmail(r *http.Request) (string, error) {
	token := extractBearerToken(r)
	if token == "" {
		return "", fmt.Errorf("missing token")
	}
	val, ok := sessions.Load(token)
	if !ok {
		return "", fmt.Errorf("invalid session")
	}
	s := val.(session)
	return s.Email, nil
}

// ============================================================
// Global state
// ============================================================

var (
	db          *sql.DB
	tenantStore *TenantStore
)

// ============================================================
// Time Windows
// ============================================================

// WindowConfig defines a single time window for rate computation.
type WindowConfig struct {
	Label   string
	Seconds int64
}

var windows = []WindowConfig{
	{"Last 10s", 10},
	{"Last 30s", 30},
	{"Last 60s", 60},
	{"Last 5min", 300},
	{"Last 30min", 1800},
	{"Last 1hr", 3600},
	{"Last 1d", 86400},
	{"Last 7d", 604800},
	{"Last 30d", 2592000},
}

// ============================================================
// Data Structures (for the JSON response)
// ============================================================

// WindowData holds the metrics for a single time window.
type WindowData struct {
	Label         string `json:"label"`
	Seconds       int64  `json:"seconds"`
	Started       int    `json:"started"`
	Completed     int    `json:"completed"`
	Failed        int    `json:"failed"`
	TimedOut      int    `json:"timed_out"`
	Cancelled     int    `json:"cancelled"`
	Open          int    `json:"open"`
	P100LatencyMs int64  `json:"p100_latency_ms"`
	StartedRate   string `json:"started_rate"`
	CompletedRate string `json:"completed_rate"`
	FailedRate    string `json:"failed_rate"`
	TimedOutRate  string `json:"timed_out_rate"`
	CancelledRate string `json:"cancelled_rate"`
	OpenRate      string `json:"open_rate"`
}

// RateData holds the success/failure percentage breakdown for a longer period.
type RateData struct {
	SuccessPct string `json:"success_pct"`
	FailurePct string `json:"failure_pct"`
	Total      int    `json:"total"`
	Success    int    `json:"success"`
	Failure    int    `json:"failure"`
}

// RecentWorkflow represents a single failed or timed-out workflow entry.
type RecentWorkflow struct {
	WorkflowRCAView
	WorkflowID    string `json:"workflow_id"`
	RunID         string `json:"run_id"`
	WorkflowType  string `json:"workflow_type"`
	TaskList      string `json:"tasklist"`
	Status        string `json:"status"`
	CloseTime     string `json:"close_time"`
	FailureReason string `json:"failure_reason"`
}

// StoredWorkflowFailure captures the persisted close-state details for a workflow run.
type StoredWorkflowFailure struct {
	TenantID          int
	WorkflowID        string
	RunID             string
	WorkflowType      string
	TaskList          string
	CloseStatus       int
	CloseTimeNS       int64
	FailureReason     string
	FailureMessage    string
	FailureDetails    string
	HistoryFetchError string
}

// TasklistLatencyEntry holds average latency for a single tasklist.
type TasklistLatencyEntry struct {
	Tasklist      string  `json:"tasklist"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
	WorkflowCount int     `json:"workflow_count"`
}

// P100ByWorkflowEntry represents the P100 (max) latency for a workflow type.
type P100ByWorkflowEntry struct {
	WorkflowType  string  `json:"workflow_type"`
	Count         int     `json:"count"`
	P100LatencyMs int64   `json:"p100_latency_ms"`
	SuccessRate   float64 `json:"success_rate"`
	FailureRate   float64 `json:"failure_rate"`
	SuccessCount  int     `json:"success_count"`
	FailureCount  int     `json:"failure_count"`
	OpenCount     int     `json:"open_count"`
}

// ActivityErrorEntry represents a single activity error type and its count in open workflows.
type ActivityErrorEntry struct {
	WorkflowType string `json:"workflow_type"`
	Error        string `json:"error"`
	Reason       string `json:"reason"`
	Message      string `json:"message"`
	Details      string `json:"details"`
	FetchError   string `json:"fetch_error"`
	Status       string `json:"status"`
	Count        int    `json:"count"`
}

// SESMetricsResponse is the JSON response for the SES metrics endpoint.
type SESMetricsResponse struct {
	DomainName       string           `json:"domain_name"`
	TenantID         int              `json:"tenant_id"`
	Timestamp        string           `json:"timestamp"`
	Sends            int64            `json:"sends"`
	Bounces          int64            `json:"bounces"`
	PermanentBounces int64            `json:"permanent_bounces"`
	TransientBounces int64            `json:"transient_bounces"`
	Complaints       int64            `json:"complaints"`
	Rejects          int64            `json:"rejects"`
	BounceRate       string           `json:"bounce_rate"`
	ComplaintRate    string           `json:"complaint_rate"`
	ErrorRate        string           `json:"error_rate"`
	PeriodDays       int              `json:"period_days"`
	DailyVolume      []SESDailyVolume `json:"daily_volume"`
}

// SESDailyVolume holds per-day SES send/bounce/complaint counts.
type SESDailyVolume struct {
	Date       string `json:"date"`
	Sends      int64  `json:"sends"`
	Bounces    int64  `json:"bounces"`
	Complaints int64  `json:"complaints"`
}

// APIResponse is the top-level JSON envelope returned by the endpoint.
type APIResponse struct {
	DomainName                   string                 `json:"domain_name"`
	TenantID                     int                    `json:"tenant_id"`
	Timestamp                    string                 `json:"timestamp"`
	Windows                      []WindowData           `json:"windows"`
	Rates30min                   RateData               `json:"rates_30min"`
	Rates1hr                     RateData               `json:"rates_1hr"`
	Rates1d                      RateData               `json:"rates_1d"`
	Rates7d                      RateData               `json:"rates_7d"`
	Rates30d                     RateData               `json:"rates_30d"`
	SelectedRate                 RateData               `json:"selected_rate"`
	RecentFailed                 []RecentWorkflow       `json:"recent_failed"`
	TotalFailed                  int                    `json:"total_failed"`
	TasklistLatency              []TasklistLatencyEntry `json:"tasklist_latency"`
	ActivityErrors               []ActivityErrorEntry   `json:"activity_errors"`
	ActivityErrorsProcessedCount int                    `json:"activity_errors_processed_count"`
	ActivityErrorsPendingCount   int                    `json:"activity_errors_pending_count"`
	ActivityErrorsPending        bool                   `json:"activity_errors_pending"`
	P100ByWorkflow               []P100ByWorkflowEntry  `json:"p100_by_workflow"`
}

// ============================================================
// Elasticsearch JSON Parsing Structures
// ============================================================

// esTotal is the "hits.total" field, which can be either an integer (ES6)
// or an object {"value": N, "relation": "eq"} (ES7+).
type esTotal struct {
	Value int `json:"value"`
}

// esShardInfo contains the _shards block in an ES response.
type esShardInfo struct {
	Total      int `json:"total"`
	Successful int `json:"successful"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
}

// esBucket is a single bucket in a terms aggregation.
type esBucket struct {
	Key      int `json:"key"`
	DocCount int `json:"doc_count"`
}

// esByStatusAgg holds the "by_status" terms aggregation.
type esByStatusAgg struct {
	Buckets []esBucket `json:"buckets"`
	// Some error cases
	DocCountErrorUpperBound int `json:"doc_count_error_upper_bound"`
	SumOtherDocCount        int `json:"sum_other_doc_count"`
}

// esMissingAgg holds the "open" missing aggregation (workflows without CloseTime).
type esMissingAgg struct {
	DocCount int `json:"doc_count"`
}

// esMaxValue holds a single max aggregation value.
type esMaxValue struct {
	Value float64 `json:"value"`
}

// esP100Latency holds the p100_latency filter aggregation result.
type esP100Latency struct {
	DocCount    int        `json:"doc_count"`
	MaxDuration esMaxValue `json:"max_duration"`
}

// esP100ByWorkflowBucket is a single bucket in the by_workflow_type aggregation.
type esP100ByWorkflowBucket struct {
	Key       string         `json:"key"`
	DocCount  int            `json:"doc_count"`
	Completed *esP100Latency `json:"completed"`
	Failed    *esP100Latency `json:"failed"`
	Open      *esP100Latency `json:"open"`
}

// esP100ByWorkflowAgg holds the by_workflow_type aggregation result.
type esP100ByWorkflowAgg struct {
	Buckets []esP100ByWorkflowBucket `json:"buckets"`
}

// esTasklistAvgLatency holds the avg latency value for a tasklist bucket.
type esTasklistAvgLatency struct {
	Value float64 `json:"value"`
}

// esTasklistLatencyBucket is a single bucket in the by_tasklist aggregation.
type esTasklistLatencyBucket struct {
	Key        string               `json:"key"`
	DocCount   int                  `json:"doc_count"`
	AvgLatency esTasklistAvgLatency `json:"avg_latency"`
}

// esTasklistAgg holds the by_tasklist aggregation result.
type esTasklistAgg struct {
	DocCountErrorUpperBound int                       `json:"doc_count_error_upper_bound"`
	SumOtherDocCount        int                       `json:"sum_other_doc_count"`
	Buckets                 []esTasklistLatencyBucket `json:"buckets"`
}

// esActivityErrorBucket is a single bucket in the by_activity_error aggregation.
type esActivityErrorBucket struct {
	Key      interface{}         `json:"key"`
	DocCount int                 `json:"doc_count"`
	ByError  *esActivityErrorAgg `json:"by_error,omitempty"`
}

// esActivityErrorAgg holds the by_activity_error aggregation result.
type esActivityErrorAgg struct {
	Buckets []esActivityErrorBucket `json:"buckets"`
}

// esAggregations holds the top-level aggregations block.
type esAggregations struct {
	ByStatus        esByStatusAgg        `json:"by_status"`
	Open            esMissingAgg         `json:"open"`
	P100Latency     *esP100Latency       `json:"p100_latency,omitempty"`
	ByTasklist      *esTasklistAgg       `json:"by_tasklist,omitempty"`
	ByActivityError *esActivityErrorAgg  `json:"by_activity_error,omitempty"`
	P100ByWorkflow  *esP100ByWorkflowAgg `json:"by_workflow_type,omitempty"`
}

// esSource is the _source of a hit in the failed/timed-out queries.
type esSource struct {
	WorkflowID   string          `json:"WorkflowID"`
	RunID        string          `json:"RunID"`
	WorkflowType string          `json:"WorkflowType"`
	TaskList     string          `json:"TaskList"`
	CloseTime    json.RawMessage `json:"CloseTime"` // can be int64 (epoch ns) or null
	CloseStatus  int             `json:"CloseStatus"`
}

// esHit is a single hit from the ES response.
type esHit struct {
	Index  string   `json:"_index"`
	ID     string   `json:"_id"`
	Score  *float64 `json:"_score"`
	Source esSource `json:"_source"`
}

// esHits holds the "hits" block.
type esHits struct {
	Total json.RawMessage `json:"total"` // number or object
	Hits  []esHit         `json:"hits"`
}

// esResponse represents a single response from the _msearch response array.
type esResponse struct {
	Took         int             `json:"took"`
	TimedOut     bool            `json:"timed_out"`
	Shards       esShardInfo     `json:"_shards"`
	Hits         esHits          `json:"hits"`
	Aggregations *esAggregations `json:"aggregations,omitempty"`
	Status       int             `json:"status,omitempty"`
	Error        json.RawMessage `json:"error,omitempty"`
}

// esMultiSearchResponse is the top-level _msearch response.
type esMultiSearchResponse struct {
	Took      int          `json:"took"`
	Responses []esResponse `json:"responses"`
}

// ============================================================
// ES Query Builder
// ============================================================

// buildMsearchBody constructs the NDJSON body for the _msearch API.
// It appends one query per time window (with aggregations) plus one query for
// recent failed/timed-out workflows and one for tasklist latency.
// statusFilter controls which CloseStatus values to include (default [1, 5]).
// tasklistFilter optionally restricts to specific tasklist names.
func buildMsearchBody(cfg Config, nowNanos int64, limit int, tasklistWindow int64, statusFilter []int, tasklistFilter []string, fromNanos, toNanos int64, offset int, activityErrorField string, activityStatusConditions []int, activityErrorDetailField string) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)

	domainFilter := buildDomainFilter(cfg)
	effectiveToNanos := toNanos
	if effectiveToNanos <= 0 {
		effectiveToNanos = nowNanos
	}
	effectiveFromNanos := fromNanos
	if effectiveFromNanos <= 0 {
		effectiveFromNanos = effectiveToNanos - (tasklistWindow * 1_000_000_000)
	}

	// --- Window queries ---
	for _, w := range windows {
		var windowFromNanos int64
		var windowToNanos int64
		if fromNanos > 0 {
			// Datepicker is active — use the custom time range for all windows
			windowFromNanos = fromNanos
			windowToNanos = toNanos
			if windowToNanos <= 0 {
				windowToNanos = nowNanos
			}
		} else {
			// No datepicker — use relative window
			windowFromNanos = nowNanos - (w.Seconds * 1_000_000_000)
			windowToNanos = nowNanos
		}

		// Header line
		header := map[string]string{"index": cfg.Index}
		_ = enc.Encode(header)

		// Query body
		body := buildWindowQuery(windowFromNanos, windowToNanos, domainFilter)
		_ = enc.Encode(body)
	}

	// --- Recent failed/timed-out workflows (combined, statusFilter determines which statuses) ---
	header := map[string]string{"index": cfg.Index}
	_ = enc.Encode(header)
	_ = enc.Encode(buildRecentQuery(statusFilter, domainFilter, limit, tasklistFilter, effectiveFromNanos, effectiveToNanos, offset))

	// --- Tasklist avg latency ---
	tlFromNanos := nowNanos - (tasklistWindow * 1_000_000_000)
	if fromNanos > 0 {
		tlFromNanos = fromNanos
	}
	_ = enc.Encode(header)
	_ = enc.Encode(buildTasklistLatencyQuery(nowNanos, domainFilter, tasklistWindow, tlFromNanos))

	// --- Activity errors (with status filter) ---
	if activityErrorField != "" {
		_ = enc.Encode(header)
		_ = enc.Encode(buildActivityErrorQuery(domainFilter, activityErrorField, activityStatusConditions, activityErrorDetailField))
	}

	// --- P100 latency by workflow type (top 100 completed workflows) ---
	// Use the tasklist window as a fallback time range when no date picker is set.
	p100FromNanos := fromNanos
	if p100FromNanos == 0 {
		p100FromNanos = nowNanos - (tasklistWindow * 1_000_000_000)
	}
	_ = enc.Encode(header)
	_ = enc.Encode(buildP100ByWorkflowTypeQuery(nowNanos, domainFilter, p100FromNanos, toNanos))

	// --- Dynamic window for the selected tasklistWindow ---
	// Adds a window matching the user's window selector so summary cards
	// (success/failure rates, volume) reflect the selected time range.
	if fromNanos <= 0 {
		dynFromNanos := nowNanos - (tasklistWindow * 1_000_000_000)
		_ = enc.Encode(header)
		_ = enc.Encode(buildWindowQuery(dynFromNanos, nowNanos, domainFilter))
	}

	return buf.Bytes()
}

// buildDomainFilter returns a slice of filter clauses to restrict to the configured domain.
func buildDomainFilter(cfg Config) []interface{} {
	if cfg.DomainID == "" {
		return nil
	}
	return []interface{}{
		map[string]interface{}{
			"term": map[string]string{"DomainID": cfg.DomainID},
		},
	}
}

// buildWindowQuery constructs the query body for a single time window.
func buildWindowQuery(fromNanos, toNanos int64, domainFilter []interface{}) map[string]interface{} {
	must := []interface{}{
		map[string]interface{}{
			"range": map[string]interface{}{
				"StartTime": map[string]int64{
					"gte": fromNanos,
					"lte": toNanos,
				},
			},
		},
	}
	// Append domain filter if present
	for _, f := range domainFilter {
		must = append(must, f)
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": must,
			},
		},
		"size":             0,
		"track_total_hits": true,
		"aggs": map[string]interface{}{
			"by_status": map[string]interface{}{
				"terms": map[string]interface{}{
					"field": "CloseStatus",
					"size":  10,
				},
			},
			"open": map[string]interface{}{
				"missing": map[string]string{
					"field": "CloseTime",
				},
			},
			"p100_latency": map[string]interface{}{
				"filter": map[string]interface{}{
					"term": map[string]string{"CloseStatus": "0"},
				},
				"aggs": map[string]interface{}{
					"max_duration": map[string]interface{}{
						"max": map[string]interface{}{
							"script": map[string]interface{}{
								"source": "doc['CloseTime'].value - doc['StartTime'].value",
								"lang":   "painless",
							},
						},
					},
				},
			},
		},
	}
}

// buildRecentQuery constructs the query body for fetching recent workflows by CloseStatus.
// statuses is a list of CloseStatus values to include (e.g. [1] for Failed, [5] for TimedOut, [1,5] for both).
// tasklistFilter optionally restricts to specific tasklist names.
func buildRecentQuery(statuses []int, domainFilter []interface{}, limit int, tasklistFilter []string, fromNanos, toNanos int64, offset int) map[string]interface{} {
	must := []interface{}{}

	// Convert CloseStatus values to strings for ES term/terms queries
	// to handle both integer and keyword field mappings reliably.
	statusStrs := make([]string, len(statuses))
	for i, s := range statuses {
		statusStrs[i] = strconv.Itoa(s)
	}

	if len(statuses) == 1 {
		must = append(must, map[string]interface{}{
			"term": map[string]string{"CloseStatus": statusStrs[0]},
		})
	} else {
		must = append(must, map[string]interface{}{
			"terms": map[string]interface{}{"CloseStatus": statusStrs},
		})
	}

	for _, f := range domainFilter {
		must = append(must, f)
	}

	if len(tasklistFilter) > 0 {
		must = append(must, map[string]interface{}{
			"terms": map[string]interface{}{"TaskList": tasklistFilter},
		})
	}

	if toNanos > 0 {
		must = append(must, map[string]interface{}{
			"range": map[string]interface{}{
				"CloseTime": map[string]int64{
					"lte": toNanos,
				},
			},
		})
	}
	if fromNanos > 0 {
		must = append(must, map[string]interface{}{
			"range": map[string]interface{}{
				"CloseTime": map[string]int64{
					"gte": fromNanos,
				},
			},
		})
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": must,
			},
		},
		"size": limit,
		"from": offset,
		"sort": []interface{}{
			map[string]interface{}{
				"CloseTime": map[string]string{
					"order": "desc",
				},
			},
		},
		"track_total_hits": true,
		"_source": []string{
			"WorkflowID",
			"RunID",
			"WorkflowType",
			"TaskList",
			"CloseTime",
			"CloseStatus",
		},
	}
}

// buildTasklistLatencyQuery constructs an ES query to get avg latency per tasklist
// for completed workflows in the last hour.
func buildTasklistLatencyQuery(nowNanos int64, domainFilter []interface{}, windowSeconds int64, windowFromNanos int64) map[string]interface{} {
	fromNanos := windowFromNanos

	must := []interface{}{
		map[string]interface{}{
			"term": map[string]string{"CloseStatus": "0"},
		},
		map[string]interface{}{
			"range": map[string]interface{}{
				"CloseTime": map[string]int64{
					"gte": fromNanos,
				},
			},
		},
	}
	for _, f := range domainFilter {
		must = append(must, f)
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": must,
				"must_not": []interface{}{
					map[string]interface{}{
						"terms": map[string]interface{}{"CloseStatus": []string{"1", "5"}},
					},
				},
			},
		},
		"size": 0,
		"aggs": map[string]interface{}{
			"by_tasklist": map[string]interface{}{
				"terms": map[string]interface{}{
					"field": "TaskList",
					"size":  50,
					"order": map[string]string{"avg_latency": "desc"},
				},
				"aggs": map[string]interface{}{
					"avg_latency": map[string]interface{}{
						"avg": map[string]interface{}{
							"script": map[string]string{
								"source": "(doc['CloseTime'].value - doc['StartTime'].value) / 1000000.0",
								"lang":   "painless",
							},
						},
					},
				},
			},
		},
	}
}

// buildActivityErrorQuery constructs an ES query to find open workflows and group them
// by a configurable field (e.g., WorkflowType or a custom search attribute for activity errors).
func buildActivityErrorQuery(domainFilter []interface{}, activityErrorField string, statusConditions []int, errorField string) map[string]interface{} {
	must := []interface{}{}

	for _, f := range domainFilter {
		must = append(must, f)
	}

	boolQuery := map[string]interface{}{
		"must": must,
	}

	// Build status filter conditions
	if len(statusConditions) > 0 {
		should := []interface{}{}
		for _, sc := range statusConditions {
			switch sc {
			case -1: // open (no CloseTime)
				should = append(should, map[string]interface{}{
					"bool": map[string]interface{}{
						"must_not": []interface{}{
							map[string]interface{}{
								"exists": map[string]string{"field": "CloseTime"},
							},
						},
					},
				})
			case -2: // closed (has CloseTime)
				should = append(should, map[string]interface{}{
					"exists": map[string]string{"field": "CloseTime"},
				})
			default: // specific CloseStatus value
				should = append(should, map[string]interface{}{
					"term": map[string]string{"CloseStatus": strconv.Itoa(sc)},
				})
			}
		}
		boolQuery["should"] = should
		boolQuery["minimum_should_match"] = 1
	}

	// Build aggregations
	aggs := map[string]interface{}{
		"by_activity_error": map[string]interface{}{
			"terms": map[string]interface{}{
				"field": activityErrorField,
				"size":  50,
				"order": map[string]string{"_count": "desc"},
			},
		},
	}

	// Add nested error aggregation if errorField is provided
	if errorField != "" && errorField != activityErrorField {
		innerAggs := aggs["by_activity_error"].(map[string]interface{})
		innerAggs["aggs"] = map[string]interface{}{
			"by_error": map[string]interface{}{
				"terms": map[string]interface{}{
					"field": errorField,
					"size":  10,
					"order": map[string]string{"_count": "desc"},
				},
			},
		}
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": boolQuery,
		},
		"size": 0,
		"aggs": aggs,
	}
}

// buildP100ByWorkflowTypeQuery constructs an ES query to find the top 100 workflow types
// by count among completed workflows, computing the P100 (max) latency for each.
func buildP100ByWorkflowTypeQuery(nowNanos int64, domainFilter []interface{}, fromNanos, toNanos int64) map[string]interface{} {
	// Remove CloseStatus filter from top-level - we want ALL workflow statuses
	// Completed workflows are filtered inside a sub-aggregation.
	// Ensure must is never nil (ES rejects null must).
	// Make a proper copy of domainFilter to avoid mutating the original slice.
	mustClause := make([]interface{}, len(domainFilter))
	copy(mustClause, domainFilter)

	// Add time range filter on StartTime (all workflows have StartTime)
	// When fromNanos is 0, it falls back to the tasklist window (set in buildMsearchBody).
	// When toNanos is 0, default to now to ensure a bounded query.
	timeRange := map[string]int64{
		"gte": fromNanos,
		"lte": toNanos,
	}
	if toNanos <= 0 {
		timeRange["lte"] = nowNanos
	}
	timeFilter := map[string]interface{}{
		"range": map[string]interface{}{
			"StartTime": timeRange,
		},
	}
	mustClause = append(mustClause, timeFilter)

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": mustClause,
			},
		},
		"size": 0,
		"aggs": map[string]interface{}{
			"by_workflow_type": map[string]interface{}{
				"terms": map[string]interface{}{
					"field": "WorkflowType",
					"size":  100,
					"order": map[string]string{"_count": "desc"},
				},
				"aggs": map[string]interface{}{
					"completed": map[string]interface{}{
						"filter": map[string]interface{}{
							"term": map[string]string{"CloseStatus": "0"},
						},
						"aggs": map[string]interface{}{
							"max_duration": map[string]interface{}{
								"max": map[string]interface{}{
									"script": map[string]interface{}{
										"source": "doc['CloseTime'].size()>0 && doc['StartTime'].size()>0 ? (doc['CloseTime'].value - doc['StartTime'].value) / 1000000 : 0",
										"lang":   "painless",
									},
								},
							},
						},
					},
					"failed": map[string]interface{}{
						"filter": map[string]interface{}{
							"terms": map[string]interface{}{
								"CloseStatus": []string{"1", "5"},
							},
						},
					},
					"open": map[string]interface{}{
						"missing": map[string]interface{}{
							"field": "CloseTime",
						},
					},
				},
			},
		},
	}
}

// ============================================================
// ES Response Parser
// ============================================================

// parseTotalHits parses the "hits.total" field which can be an integer
// (ES6) or an object {"value": N} (ES7+).
func parseTotalHits(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}

	// Try to parse as an integer first (ES6 style)
	var val int
	if err := json.Unmarshal(raw, &val); err == nil {
		return val
	}

	// Try to parse as an object (ES7+ style)
	var totalObj esTotal
	if err := json.Unmarshal(raw, &totalObj); err == nil {
		return totalObj.Value
	}

	return 0
}

// parseWindowResponse extracts a WindowData from an ES response for a window query.
func parseWindowResponse(resp esResponse, w WindowConfig) WindowData {
	totalHits := parseTotalHits(resp.Hits.Total)

	completed := 0
	failed := 0
	cancelled := 0
	timedOut := 0
	openWF := 0
	var p100LatencyNs float64

	if resp.Aggregations != nil {
		for _, b := range resp.Aggregations.ByStatus.Buckets {
			// Convert key to string for comparison — ES may return CloseStatus as
			// an integer (long mapping) or a string (keyword mapping).
			keyStr := fmt.Sprintf("%v", b.Key)
			switch keyStr {
			case "0": // Completed
				completed = b.DocCount
			case "1": // Failed
				failed = b.DocCount
			case "4": // Cancelled / ContinuedAsNew
				cancelled = b.DocCount
			case "5": // TimedOut
				timedOut = b.DocCount
			}
		}
		openWF = resp.Aggregations.Open.DocCount

		if resp.Aggregations.P100Latency != nil {
			p100LatencyNs = resp.Aggregations.P100Latency.MaxDuration.Value
		}
	}

	secs := float64(w.Seconds)

	// Convert latency from nanoseconds to milliseconds
	p100Ms := int64(0)
	if p100LatencyNs > 0 {
		p100Ms = int64(p100LatencyNs / 1_000_000)
	}

	return WindowData{
		Label:         w.Label,
		Seconds:       w.Seconds,
		Started:       totalHits,
		Completed:     completed,
		Failed:        failed,
		TimedOut:      timedOut,
		Cancelled:     cancelled,
		Open:          openWF,
		P100LatencyMs: p100Ms,
		StartedRate:   formatRate(totalHits, secs),
		CompletedRate: formatRate(completed, secs),
		FailedRate:    formatRate(failed, secs),
		TimedOutRate:  formatRate(timedOut, secs),
		CancelledRate: formatRate(cancelled, secs),
		OpenRate:      formatRate(openWF, secs),
	}
}

// formatRate returns a rate string like "10.00/s".
func formatRate(count int, seconds float64) string {
	if seconds <= 0 {
		return "0.00/s"
	}
	return fmt.Sprintf("%.2f/s", float64(count)/seconds)
}

// formatPercentage returns a percentage string like "98.5".
func formatPercentage(num, den int) string {
	if den <= 0 {
		return "N/A"
	}
	return fmt.Sprintf("%.1f", float64(num)*100.0/float64(den))
}

func workflowCloseStatusLabel(status int) string {
	switch status {
	case 0:
		return "Completed"
	case 1:
		return "Failed"
	case 2:
		return "Cancelled"
	case 3:
		return "Terminated"
	case 4:
		return "ContinuedAsNew"
	case 5:
		return "TimedOut"
	default:
		return fmt.Sprintf("Status:%d", status)
	}
}

func parseEpochNanos(raw json.RawMessage) int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}

	var ns int64
	if err := json.Unmarshal(raw, &ns); err == nil {
		return ns
	}

	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if parsed, err2 := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err2 == nil {
			return parsed
		}
	}

	return 0
}

// parseRecentHits extracts recent failed/timed-out workflows from ES response hits.
func parseRecentHits(resp esResponse) []RecentWorkflow {
	hits := resp.Hits.Hits
	if len(hits) == 0 {
		return nil
	}

	result := make([]RecentWorkflow, 0, len(hits))
	for _, hit := range hits {
		src := hit.Source
		closeTimeStr := formatCloseTime(src.CloseTime)

		result = append(result, RecentWorkflow{
			WorkflowID:   src.WorkflowID,
			RunID:        src.RunID,
			WorkflowType: src.WorkflowType,
			TaskList:     src.TaskList,
			Status:       workflowCloseStatusLabel(src.CloseStatus),
			CloseTime:    closeTimeStr,
		})
	}
	return result
}

func recentWorkflowLookupKey(workflowID, runID string) string {
	return workflowID + "\x00" + runID
}

func loadStoredRecentFailureReasons(tenantID int, recent []RecentWorkflow) map[string]string {
	if tenantID <= 0 || len(recent) == 0 {
		return nil
	}

	args := []any{tenantID}
	values := make([]string, 0, len(recent))
	seen := make(map[string]struct{}, len(recent))
	for _, wf := range recent {
		if strings.TrimSpace(wf.WorkflowID) == "" || strings.TrimSpace(wf.RunID) == "" {
			continue
		}
		key := recentWorkflowLookupKey(wf.WorkflowID, wf.RunID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		args = append(args, wf.WorkflowID, wf.RunID)
		values = append(values, fmt.Sprintf("($%d, $%d)", len(args)-1, len(args)))
	}
	if len(values) == 0 {
		return nil
	}

	query := fmt.Sprintf(`
		SELECT
			wf.workflow_id,
			wf.run_id,
			COALESCE(NULLIF(wf.failure_reason, ''), '') AS failure_reason,
			COALESCE(NULLIF(wf.failure_message, ''), '') AS failure_message,
			COALESCE(NULLIF(wf.failure_details, ''), '') AS failure_details,
			COALESCE(NULLIF(wf.history_fetch_error, ''), '') AS history_fetch_error,
			wf.close_status
		FROM workflow_failures wf
		JOIN (VALUES %s) AS recent(workflow_id, run_id)
		  ON wf.workflow_id = recent.workflow_id
		 AND wf.run_id = recent.run_id
		WHERE wf.tenant_id = $1`,
		strings.Join(values, ", "),
	)

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("WARN: recent failure reason lookup tenant %d: %v", tenantID, err)
		return nil
	}
	defer rows.Close()

	out := make(map[string]string, len(values))
	for rows.Next() {
		var workflowID string
		var runID string
		var reason string
		var message string
		var details string
		var fetchError string
		var closeStatus int
		if err := rows.Scan(&workflowID, &runID, &reason, &message, &details, &fetchError, &closeStatus); err != nil {
			log.Printf("WARN: recent failure reason scan tenant %d: %v", tenantID, err)
			continue
		}
		out[recentWorkflowLookupKey(workflowID, runID)] = storedActivityErrorText(
			reason,
			message,
			details,
			fetchError,
			workflowCloseStatusLabel(closeStatus),
		)
	}
	if err := rows.Err(); err != nil {
		log.Printf("WARN: recent failure reason iteration tenant %d: %v", tenantID, err)
	}
	return out
}

// formatCloseTime converts a CloseTime from epoch nanoseconds (int64) to a readable string.
// CloseTime can also be null/missing.
func formatCloseTime(raw json.RawMessage) string {
	ns := parseEpochNanos(raw)
	if ns <= 0 {
		return "N/A"
	}

	t := time.Unix(0, ns)
	return t.Format("2006-01-02 15:04:05")
}

// ============================================================
// ES Client
// ============================================================

// queryElasticsearch sends the _msearch request and returns the parsed response.
// getGCPIdentityToken fetches a Google identity token from the GCP metadata server
// for the given audience URL. It caches the token and refreshes it every 50 minutes
// (tokens expire in 1 hour).
func getGCPIdentityToken(audienceURL string) (string, error) {
	if audienceURL == "" {
		return "", nil
	}

	// Check cache first
	if val, ok := gcpTokenCache.Load(audienceURL); ok {
		entry := val.(*gcpTokenEntry)
		entry.mu.RLock()
		token := entry.Token
		expiresAt := entry.ExpiresAt
		entry.mu.RUnlock()
		// Refresh 10 minutes before expiry (tokens expire in ~1 hour)
		if token != "" && time.Now().Add(10*time.Minute).Before(expiresAt) {
			return token, nil
		}
	}

	// Fetch a new token from the GCP metadata server
	metadataURL := "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" + url.QueryEscape(audienceURL)
	req, err := http.NewRequest(http.MethodGet, metadataURL, nil)
	if err != nil {
		return "", fmt.Errorf("create metadata request: %w", err)
	}
	req.Header.Set("Metadata-Flavor", "Google")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("metadata request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read metadata response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata returned status %d: %s", resp.StatusCode, string(body))
	}

	token := strings.TrimSpace(string(body))
	if token == "" {
		return "", fmt.Errorf("empty token from metadata server")
	}

	// Cache the token with a 50-minute refresh window (tokens expire in ~1 hour)
	entry := &gcpTokenEntry{
		Token:     token,
		ExpiresAt: time.Now().Add(50 * time.Minute),
	}
	gcpTokenCache.Store(audienceURL, entry)

	return token, nil
}

// resolveESBaseURL returns the HTTP base URL for ES _msearch and whether GCP audience auth applies.
// The request always goes to es_endpoint; when audience_url is set, a GCP identity Bearer token is used.
// When audience_url is empty, requests fall back to x-api-key auth.
func resolveESBaseURL(cfg Config) (baseURL string, useAudienceAuth bool, err error) {
	es := strings.TrimRight(strings.TrimSpace(cfg.ES), "/")
	if es == "" {
		return "", false, fmt.Errorf("es_endpoint not configured")
	}
	if !strings.HasPrefix(es, "http://") && !strings.HasPrefix(es, "https://") {
		es = "https://" + es
	}
	return es, cfg.AudienceURL != "", nil
}

func queryElasticsearch(cfg Config, limit int, tasklistWindow int64, statusFilter []int, tasklistFilter []string, fromNanos, toNanos int64, offset int, activityErrorField string, activityStatusConditions []int, activityErrorDetailField string) (*esMultiSearchResponse, error) {
	nowNanos := time.Now().UnixNano()
	body := buildMsearchBody(cfg, nowNanos, limit, tasklistWindow, statusFilter, tasklistFilter, fromNanos, toNanos, offset, activityErrorField, activityStatusConditions, activityErrorDetailField)

	baseURL, useAudienceAuth, err := resolveESBaseURL(cfg)
	if err != nil {
		return nil, err
	}
	url := baseURL + "/_msearch"

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-ndjson")

	if useAudienceAuth {
		token, err := getGCPIdentityToken(cfg.AudienceURL)
		if err != nil {
			return nil, fmt.Errorf("GCP identity token for audience %s: %w", cfg.AudienceURL, err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	} else if cfg.ESApiKey != "" {
		req.Header.Set("x-api-key", cfg.ESApiKey)
	}

	timeout := 15 * time.Second
	if limit > 100 {
		timeout = 30 * time.Second
	}
	if limit > 200 {
		timeout = 45 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to query ES: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read ES response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ES returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var msResp esMultiSearchResponse
	if err := json.Unmarshal(respBody, &msResp); err != nil {
		return nil, fmt.Errorf("failed to parse ES response: %w (body: %s)", err, string(respBody))
	}

	return &msResp, nil
}

type historyFailureSummary struct {
	Reason  string
	Message string
	Details string
}

func (h historyFailureSummary) empty() bool {
	return strings.TrimSpace(h.Reason) == "" &&
		strings.TrimSpace(h.Message) == "" &&
		strings.TrimSpace(h.Details) == ""
}

func mergeHistoryFailure(primary, fallback historyFailureSummary) historyFailureSummary {
	if strings.TrimSpace(primary.Reason) == "" {
		primary.Reason = fallback.Reason
	}
	if strings.TrimSpace(primary.Message) == "" {
		primary.Message = fallback.Message
	}
	if strings.TrimSpace(primary.Details) == "" {
		primary.Details = fallback.Details
	}
	return primary
}

func mapStringAny(value any) map[string]any {
	m, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return m
}

func historyStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := m[key]; ok {
			switch v := raw.(type) {
			case string:
				if s := strings.TrimSpace(v); s != "" {
					return s
				}
			case fmt.Stringer:
				if s := strings.TrimSpace(v.String()); s != "" {
					return s
				}
			case float64:
				return strconv.FormatFloat(v, 'f', -1, 64)
			case int:
				return strconv.Itoa(v)
			case int64:
				return strconv.FormatInt(v, 10)
			}
		}
	}
	return ""
}

func looksLikeBase64String(s string) bool {
	if len(s) < 8 || len(s)%4 != 0 {
		return false
	}
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '+' || r == '/' || r == '=' {
			continue
		}
		return false
	}
	return true
}

func decodeHistoryPayload(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, decodeHistoryPayload(item))
		}
		return out
	case map[string]any:
		if nested, ok := v["data"]; ok {
			return decodeHistoryPayload(nested)
		}
		if nested, ok := v["Data"]; ok {
			return decodeHistoryPayload(nested)
		}
		if payloads, ok := v["payloads"].([]any); ok {
			out := make([]any, 0, len(payloads))
			for _, item := range payloads {
				out = append(out, decodeHistoryPayload(item))
			}
			return out
		}
		out := make(map[string]any, len(v))
		for k, item := range v {
			out[k] = decodeHistoryPayload(item)
		}
		return out
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return ""
		}
		if looksLikeBase64String(trimmed) {
			if decoded, err := base64.StdEncoding.DecodeString(trimmed); err == nil {
				text := strings.TrimSpace(string(decoded))
				if text != "" {
					var parsed any
					if err := json.Unmarshal(decoded, &parsed); err == nil {
						return decodeHistoryPayload(parsed)
					}
					return text
				}
			}
		}
		var parsed any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			return decodeHistoryPayload(parsed)
		}
		return v
	default:
		return value
	}
}

func formatHistoryPayload(value any) string {
	decoded := decodeHistoryPayload(value)
	switch v := decoded.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	default:
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return fmt.Sprintf("%v", decoded)
		}
		return string(b)
	}
}

func historyFailureFromFailureObject(value any) historyFailureSummary {
	failure := mapStringAny(value)
	if failure == nil {
		return historyFailureSummary{}
	}
	summary := historyFailureSummary{
		Reason:  historyStringField(failure, "reason", "Reason"),
		Message: historyStringField(failure, "message", "Message"),
		Details: formatHistoryPayload(firstHistoryValue(failure, "details", "Details")),
	}
	if cause := historyFailureFromFailureObject(firstHistoryValue(failure, "cause", "Cause")); !cause.empty() {
		summary = mergeHistoryFailure(summary, cause)
	}
	return summary
}

func firstHistoryValue(m map[string]any, keys ...string) any {
	for _, key := range keys {
		if raw, ok := m[key]; ok {
			return raw
		}
	}
	return nil
}

func historyFailureFromAttrs(attrs map[string]any, eventType string) historyFailureSummary {
	if attrs == nil {
		return historyFailureSummary{}
	}
	if failure := historyFailureFromFailureObject(firstHistoryValue(attrs, "failure", "Failure")); !failure.empty() {
		return failure
	}

	summary := historyFailureSummary{
		Reason:  historyStringField(attrs, "reason", "Reason"),
		Message: historyStringField(attrs, "message", "Message"),
		Details: formatHistoryPayload(firstHistoryValue(attrs, "details", "Details")),
	}

	if strings.Contains(eventType, "TimedOut") {
		if summary.Reason == "" {
			summary.Reason = historyStringField(attrs, "timeoutType", "TimeoutType")
		}
		if summary.Message == "" {
			summary.Message = "Workflow timed out"
		}
	}
	if strings.Contains(eventType, "Terminated") && summary.Message == "" {
		summary.Message = "Workflow terminated"
	}
	if (strings.Contains(eventType, "Canceled") || strings.Contains(eventType, "Cancelled")) && summary.Message == "" {
		summary.Message = "Workflow cancelled"
	}
	if strings.Contains(eventType, "Failed") && summary.Message == "" && summary.Reason == "" {
		summary.Message = "Workflow failed"
	}

	return summary
}

func genericFailureReason(reason string) bool {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "", "cadenceinternal:generic", "generic":
		return true
	default:
		return false
	}
}

func firstMeaningfulHistoryLine(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && line != "{" && line != "}" && line != "[" && line != "]" {
			return line
		}
	}
	return trimmed
}

func storedActivityErrorText(reason, message, details, fetchError, status string) string {
	trimmedMessage := strings.TrimSpace(message)
	trimmedReason := strings.TrimSpace(reason)
	trimmedFetchError := strings.TrimSpace(fetchError)
	detailLine := firstMeaningfulHistoryLine(details)

	switch {
	case trimmedMessage != "" && !strings.EqualFold(trimmedMessage, "Workflow failed"):
		return trimmedMessage
	case detailLine != "":
		return detailLine
	case trimmedMessage != "":
		return trimmedMessage
	case trimmedReason != "" && !genericFailureReason(trimmedReason):
		return trimmedReason
	case trimmedFetchError != "":
		return trimmedFetchError
	case trimmedReason != "":
		return trimmedReason
	default:
		return status
	}
}

func historyAttributesPointer(event map[string]any) string {
	if raw, ok := event["attributes"].(string); ok {
		return raw
	}
	if raw, ok := event["Attributes"].(string); ok {
		return raw
	}
	return ""
}

func historyAttrs(event map[string]any) map[string]any {
	if ptr := historyAttributesPointer(event); ptr != "" {
		if attrs := mapStringAny(event[ptr]); attrs != nil {
			return attrs
		}
	}
	for key, value := range event {
		if strings.HasSuffix(key, "EventAttributes") {
			if attrs := mapStringAny(value); attrs != nil {
				return attrs
			}
		}
	}
	return nil
}

func historyEventTypeFromAttrsKey(key string) string {
	if !strings.HasSuffix(key, "EventAttributes") {
		return ""
	}
	base := strings.TrimSuffix(key, "EventAttributes")
	if base == "" {
		return ""
	}
	return strings.ToUpper(base[:1]) + base[1:]
}

func inferHistoryEventType(event map[string]any) string {
	if ptr := historyAttributesPointer(event); ptr != "" {
		if eventType := historyEventTypeFromAttrsKey(ptr); eventType != "" {
			return eventType
		}
	}
	for key := range event {
		if eventType := historyEventTypeFromAttrsKey(key); eventType != "" {
			return eventType
		}
	}
	if raw := historyStringField(event, "eventType", "EventType", "type", "Type"); raw != "" {
		if code, err := strconv.Atoi(raw); err == nil {
			switch code {
			case 2:
				return "WorkflowExecutionFailed"
			case 3:
				return "WorkflowExecutionTimedOut"
			case 12:
				return "ActivityTaskFailed"
			case 13:
				return "ActivityTaskTimedOut"
			}
		}
		return raw
	}
	return ""
}

func extractStoredFailureFromHistory(historyData []byte) historyFailureSummary {
	var payload struct {
		Events []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(historyData, &payload); err != nil {
		return historyFailureSummary{}
	}

	var workflowFailure historyFailureSummary
	var activityFailure historyFailureSummary

	for _, rawEvent := range payload.Events {
		var event map[string]any
		if err := json.Unmarshal(rawEvent, &event); err != nil {
			continue
		}
		if wrapped := mapStringAny(event["historyEvent"]); wrapped != nil {
			event = wrapped
		} else if wrapped := mapStringAny(event["HistoryEvent"]); wrapped != nil {
			event = wrapped
		}

		eventType := inferHistoryEventType(event)
		attrs := historyAttrs(event)
		switch {
		case strings.HasPrefix(eventType, "WorkflowExecution"):
			if strings.Contains(eventType, "Failed") ||
				strings.Contains(eventType, "TimedOut") ||
				strings.Contains(eventType, "Terminated") ||
				strings.Contains(eventType, "Canceled") ||
				strings.Contains(eventType, "Cancelled") {
				workflowFailure = historyFailureFromAttrs(attrs, eventType)
			}
		case strings.Contains(eventType, "ActivityTaskFailed") || strings.Contains(eventType, "ActivityTaskTimedOut"):
			if failure := historyFailureFromAttrs(attrs, eventType); !failure.empty() {
				activityFailure = failure
			}
		}
	}

	if workflowFailure.empty() {
		return activityFailure
	}
	return mergeHistoryFailure(workflowFailure, activityFailure)
}

func storedWorkflowFailureNeedsSync(ctx context.Context, tenant *Tenant, workflowID, runID string) (bool, error) {
	if tenant == nil {
		return false, fmt.Errorf("tenant is nil for workflow sync lookup")
	}

	var historyFetchError string
	err := db.QueryRowContext(ctx,
		`SELECT COALESCE(history_fetch_error, '')
		FROM workflow_failures
		WHERE tenant_id = $1 AND workflow_id = $2 AND run_id = $3`,
		tenant.ID, workflowID, runID,
	).Scan(&historyFetchError)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("lookup stored workflow failure %s/%s: %w", workflowID, runID, err)
	}

	return strings.TrimSpace(tenant.CadenceWebURL) != "" && strings.TrimSpace(historyFetchError) != "", nil
}

func workflowFailureFetchKey(tenantID int, workflowID, runID string) string {
	return fmt.Sprintf("%d:%s:%s", tenantID, workflowID, runID)
}

func upsertStoredWorkflowFailure(ctx context.Context, failure StoredWorkflowFailure) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO workflow_failures (
			tenant_id, workflow_id, run_id, workflow_type, tasklist, close_status, close_time_ns,
			failure_reason, failure_message, failure_details, history_fetch_error, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
		ON CONFLICT (tenant_id, workflow_id, run_id) DO UPDATE SET
			workflow_type = EXCLUDED.workflow_type,
			tasklist = EXCLUDED.tasklist,
			close_status = EXCLUDED.close_status,
			close_time_ns = EXCLUDED.close_time_ns,
			failure_reason = EXCLUDED.failure_reason,
			failure_message = EXCLUDED.failure_message,
			failure_details = EXCLUDED.failure_details,
			history_fetch_error = EXCLUDED.history_fetch_error,
			updated_at = NOW()`,
		failure.TenantID,
		failure.WorkflowID,
		failure.RunID,
		failure.WorkflowType,
		failure.TaskList,
		failure.CloseStatus,
		failure.CloseTimeNS,
		failure.FailureReason,
		failure.FailureMessage,
		failure.FailureDetails,
		failure.HistoryFetchError,
	)
	if err != nil {
		return fmt.Errorf("upsert workflow failure %s/%s: %w", failure.WorkflowID, failure.RunID, err)
	}
	return nil
}

func syncWorkflowFailureHit(ctx context.Context, tenant *Tenant, hit esHit) error {
	src := hit.Source
	needsSync, err := storedWorkflowFailureNeedsSync(ctx, tenant, src.WorkflowID, src.RunID)
	if err != nil {
		return err
	}
	if !needsSync {
		return nil
	}

	stored := StoredWorkflowFailure{
		TenantID:     tenant.ID,
		WorkflowID:   src.WorkflowID,
		RunID:        src.RunID,
		WorkflowType: src.WorkflowType,
		TaskList:     src.TaskList,
		CloseStatus:  src.CloseStatus,
		CloseTimeNS:  parseEpochNanos(src.CloseTime),
	}

	if tenant.CadenceWebURL == "" {
		stored.HistoryFetchError = "cadence_web_url not configured"
	} else {
		histCtx, cancel := context.WithTimeout(ctx, workflowFailureHistoryFetchTimout)
		historyData, err := fetchWorkflowHistory(histCtx, tenant.CadenceWebURL, tenant.DomainName, src.WorkflowID, src.RunID, "cluster0", tenant.AudienceURL)
		cancel()
		if err != nil {
			stored.HistoryFetchError = err.Error()
		} else {
			failure := extractStoredFailureFromHistory(historyData)
			stored.FailureReason = strings.TrimSpace(failure.Reason)
			stored.FailureMessage = strings.TrimSpace(failure.Message)
			stored.FailureDetails = strings.TrimSpace(failure.Details)
		}
	}

	return upsertStoredWorkflowFailure(ctx, stored)
}

func recentWorkflowHitsFromMultiSearch(msResp *esMultiSearchResponse) []esHit {
	if msResp == nil {
		return nil
	}
	recentIdx := len(windows)
	if recentIdx < 0 || recentIdx >= len(msResp.Responses) {
		return nil
	}
	return msResp.Responses[recentIdx].Hits.Hits
}

func queueWorkflowFailureEnrichment(ctx context.Context, tenant *Tenant, hits []esHit) int {
	if workflowFailureQueue == nil || tenant == nil || len(hits) == 0 {
		return 0
	}

	queued := 0
	for _, hit := range hits {
		src := hit.Source
		needsSync, err := storedWorkflowFailureNeedsSync(ctx, tenant, src.WorkflowID, src.RunID)
		if err != nil {
			log.Printf("WARN: workflow failure queue tenant=%d lookup %s/%s: %v", tenant.ID, src.WorkflowID, src.RunID, err)
			continue
		}
		if !needsSync {
			continue
		}

		fetchKey := workflowFailureFetchKey(tenant.ID, src.WorkflowID, src.RunID)
		if _, loaded := workflowFailureFetches.LoadOrStore(fetchKey, struct{}{}); loaded {
			continue
		}

		job := workflowFailureEnrichmentJob{
			Tenant:   *tenant,
			Hit:      hit,
			FetchKey: fetchKey,
		}

		select {
		case workflowFailureQueue <- job:
			queued++
		default:
			workflowFailureFetches.Delete(fetchKey)
			log.Printf("WARN: workflow failure queue full; dropping tenant=%d workflow=%s run=%s", tenant.ID, src.WorkflowID, src.RunID)
		}
	}

	return queued
}

func sumActivityErrorCounts(entries []ActivityErrorEntry) int {
	total := 0
	for _, entry := range entries {
		total += entry.Count
	}
	return total
}

func activityStatusUsesStoredBreakdown(conditions []int) bool {
	if len(conditions) == 0 {
		return false
	}
	for _, cond := range conditions {
		if cond != 1 && cond != 5 {
			return false
		}
	}
	return true
}

func normalizeStoredFailureStatusConditions(conditions []int) []int {
	if len(conditions) == 0 {
		return nil
	}
	seen := make(map[int]struct{})
	var out []int
	for _, cond := range conditions {
		if cond == -2 {
			return nil
		}
		if cond < 0 {
			continue
		}
		if _, ok := seen[cond]; ok {
			continue
		}
		seen[cond] = struct{}{}
		out = append(out, cond)
	}
	if len(out) == 0 {
		return []int{-999999}
	}
	sort.Ints(out)
	return out
}

func effectiveWorkflowFailureRange(tasklistWindow int64, fromNanos, toNanos int64) (int64, int64) {
	effectiveTo := toNanos
	if effectiveTo <= 0 {
		effectiveTo = time.Now().UnixNano()
	}
	effectiveFrom := fromNanos
	if effectiveFrom <= 0 {
		effectiveFrom = effectiveTo - tasklistWindow*1_000_000_000
	}
	return effectiveFrom, effectiveTo
}

func loadStoredActivityErrors(ctx context.Context, tenantID int, tasklistWindow int64, fromNanos, toNanos int64, tasklistFilter []string, statusConditions []int) ([]ActivityErrorEntry, error) {
	effectiveFrom, effectiveTo := effectiveWorkflowFailureRange(tasklistWindow, fromNanos, toNanos)
	where := []string{
		"tenant_id = $1",
		"close_time_ns >= $2",
		"close_time_ns <= $3",
	}
	args := []any{tenantID, effectiveFrom, effectiveTo}

	if len(tasklistFilter) > 0 {
		args = append(args, pq.Array(tasklistFilter))
		where = append(where, fmt.Sprintf("tasklist = ANY($%d)", len(args)))
	}

	statusCodes := normalizeStoredFailureStatusConditions(statusConditions)
	if len(statusCodes) > 0 {
		args = append(args, pq.Array(statusCodes))
		where = append(where, fmt.Sprintf("close_status = ANY($%d)", len(args)))
	}

	query := fmt.Sprintf(`
		SELECT
			workflow_type,
			COALESCE(NULLIF(failure_reason, ''), '') AS reason,
			COALESCE(NULLIF(failure_message, ''), '') AS message,
			COALESCE(NULLIF(failure_details, ''), '') AS details,
			COALESCE(NULLIF(history_fetch_error, ''), '') AS fetch_error,
			close_status,
			COUNT(*) AS count,
			SUM(COUNT(*)) OVER (PARTITION BY workflow_type) AS workflow_total
		FROM workflow_failures
		WHERE %s
		GROUP BY workflow_type, COALESCE(NULLIF(failure_reason, ''), ''), COALESCE(NULLIF(failure_message, ''), ''), COALESCE(NULLIF(failure_details, ''), ''), COALESCE(NULLIF(history_fetch_error, ''), ''), close_status
		ORDER BY workflow_total DESC, workflow_type ASC, count DESC, reason ASC, message ASC
		LIMIT 1000`,
		strings.Join(where, " AND "),
	)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query stored activity errors: %w", err)
	}
	defer rows.Close()

	results := make([]ActivityErrorEntry, 0)
	for rows.Next() {
		var entry ActivityErrorEntry
		var closeStatus int
		var workflowTotal int
		if err := rows.Scan(&entry.WorkflowType, &entry.Reason, &entry.Message, &entry.Details, &entry.FetchError, &closeStatus, &entry.Count, &workflowTotal); err != nil {
			return nil, fmt.Errorf("scan stored activity error: %w", err)
		}
		entry.Status = workflowCloseStatusLabel(closeStatus)
		entry.Error = storedActivityErrorText(entry.Reason, entry.Message, entry.Details, entry.FetchError, entry.Status)
		results = append(results, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stored activity errors: %w", err)
	}

	return results, nil
}

// ============================================================
// Response Builder
// ============================================================

// buildResponse assembles the final APIResponse from the _msearch results.
func buildResponse(cfg Config, tenantID int, msResp *esMultiSearchResponse, limit int, statusFilter []int, activityErrorField string, activityErrorDetailField string, tasklistWindow int64) (APIResponse, int) {
	responses := msResp.Responses
	expected := len(windows) + 3 // window queries + recent failed/timed-out + tasklist latency + p100 by workflow type
	if activityErrorField != "" {
		expected++ // + activity error query
	}
	// Check if a dynamic window was added for the selected tasklistWindow
	hasDynamicWindow := tasklistWindow > 0
	if hasDynamicWindow {
		expected++ // + dynamic window for selected range
	}

	// Ensure we have enough responses
	if len(responses) < expected {
		log.Printf("WARN: Expected %d responses from _msearch, got %d", expected, len(responses))
	}

	// --- Parse windows ---
	windowData := make([]WindowData, 0, len(windows))
	for i, w := range windows {
		if i >= len(responses) {
			windowData = append(windowData, WindowData{
				Label:   w.Label,
				Seconds: w.Seconds,
			})
			continue
		}
		resp := responses[i]

		// Check for ES-level errors in the individual response
		if len(resp.Error) > 0 {
			log.Printf("WARN: ES error for window %s: %s", w.Label, string(resp.Error))
		}

		windowData = append(windowData, parseWindowResponse(resp, w))
	}

	// --- Compute rates for 30min, 1hr, 1d, 7d, 30d ---
	rate30min := computeRateData(windowData, 4) // index 4 = Last 30min
	rate1hr := computeRateData(windowData, 5)   // index 5 = Last 1hr
	rate1d := computeRateData(windowData, 6)    // index 6 = Last 1d
	rate7d := computeRateData(windowData, 7)    // index 7 = Last 7d
	rate30d := computeRateData(windowData, 8)   // index 8 = Last 30d

	// --- Parse recent failed/timed-out workflows ---
	recentIdx := len(windows)

	var recentFailed []RecentWorkflow
	totalFailed := 0

	if recentIdx < len(responses) {
		recentFailed = parseRecentHits(responses[recentIdx])
		totalFailed = parseTotalHits(responses[recentIdx].Hits.Total)
		if len(recentFailed) > limit {
			recentFailed = recentFailed[:limit]
		}
		storedReasons := loadStoredRecentFailureReasons(tenantID, recentFailed)
		for i := range recentFailed {
			if reason := storedReasons[recentWorkflowLookupKey(recentFailed[i].WorkflowID, recentFailed[i].RunID)]; strings.TrimSpace(reason) != "" {
				recentFailed[i].FailureReason = reason
			}
		}
		attachWorkflowRCAToRecentFailures(tenantID, recentFailed)
	}

	// --- Parse tasklist latency ---
	tasklistIdx := len(windows) + 1
	var tasklistLatency []TasklistLatencyEntry
	if tasklistIdx < len(responses) {
		resp := responses[tasklistIdx]
		if resp.Aggregations != nil && resp.Aggregations.ByTasklist != nil {
			for _, b := range resp.Aggregations.ByTasklist.Buckets {
				tasklistLatency = append(tasklistLatency, TasklistLatencyEntry{
					Tasklist:      b.Key,
					AvgLatencyMs:  b.AvgLatency.Value,
					WorkflowCount: b.DocCount,
				})
			}
		}
	}

	// --- Parse activity errors in open workflows ---
	var activityErrors []ActivityErrorEntry
	if activityErrorField != "" {
		activityErrorIdx := len(windows) + 2 // after windows, recent, and tasklist latency
		if activityErrorIdx < len(responses) {
			resp := responses[activityErrorIdx]
			if resp.Aggregations != nil && resp.Aggregations.ByActivityError != nil {
				for _, b := range resp.Aggregations.ByActivityError.Buckets {
					if b.ByError != nil && len(b.ByError.Buckets) > 0 {
						// Flatten nested aggregation: each workflow type with its error reasons
						for _, eb := range b.ByError.Buckets {
							activityErrors = append(activityErrors, ActivityErrorEntry{
								WorkflowType: fmt.Sprintf("%v", b.Key),
								Error:        fmt.Sprintf("%v", eb.Key),
								Count:        eb.DocCount,
							})
						}
					} else {
						activityErrors = append(activityErrors, ActivityErrorEntry{
							WorkflowType: fmt.Sprintf("%v", b.Key),
							Count:        b.DocCount,
						})
					}
				}
			}
		}
	}

	// --- Parse P100 latency by workflow type (top 100 completed workflows) ---
	var p100ByWorkflow []P100ByWorkflowEntry
	p100WorkflowIdx := len(windows) + 2 // after windows and recent and tasklist latency
	if activityErrorField != "" {
		p100WorkflowIdx++ // after activity errors
	}
	if p100WorkflowIdx < len(responses) {
		resp := responses[p100WorkflowIdx]
		if len(resp.Error) > 0 {
			log.Printf("ERROR: P100 ES query error: %s", string(resp.Error))
		}
		if resp.Aggregations != nil && resp.Aggregations.P100ByWorkflow != nil {
			for _, b := range resp.Aggregations.P100ByWorkflow.Buckets {
				totalCount := b.DocCount
				completedCount := 0
				p100Ms := int64(0)
				if b.Completed != nil {
					completedCount = b.Completed.DocCount
					if b.Completed.MaxDuration.Value > 0 {
						p100Ms = int64(b.Completed.MaxDuration.Value)
					}
				}
				successRate := 0.0
				if totalCount > 0 {
					successRate = math.Round(float64(completedCount)/float64(totalCount)*1000) / 10
				}
				failedCount := 0
				if b.Failed != nil {
					failedCount = b.Failed.DocCount
				}
				failureRate := 0.0
				if totalCount > 0 {
					failureRate = math.Round(float64(failedCount)/float64(totalCount)*1000) / 10
				}
				openCount := 0
				if b.Open != nil {
					openCount = b.Open.DocCount
				}
				p100ByWorkflow = append(p100ByWorkflow, P100ByWorkflowEntry{
					WorkflowType:  b.Key,
					Count:         totalCount,
					P100LatencyMs: p100Ms,
					SuccessRate:   successRate,
					FailureRate:   failureRate,
					SuccessCount:  completedCount,
					FailureCount:  failedCount,
					OpenCount:     openCount,
				})
			}
		}
	}

	ts := time.Now().Format("2006-01-02 15:04:05")

	// Compute selected rate from the dynamic window response (last response)
	selectedRate := RateData{}
	if hasDynamicWindow && len(responses) > 0 {
		dynIdx := len(responses) - 1
		if dynIdx >= 0 {
			dynResp := responses[dynIdx]
			dynWC := WindowConfig{Label: fmt.Sprintf("Selected %ds", tasklistWindow), Seconds: tasklistWindow}
			dynWD := parseWindowResponse(dynResp, dynWC)
			total := dynWD.Started
			failure := dynWD.Failed + dynWD.TimedOut
			success := total - failure
			successPct := "N/A"
			failurePct := "N/A"
			if total > 0 {
				successPct = fmt.Sprintf("%.1f", float64(success)/float64(total)*100)
				failurePct = fmt.Sprintf("%.1f", float64(failure)/float64(total)*100)
			}
			selectedRate = RateData{
				SuccessPct: successPct,
				FailurePct: failurePct,
				Total:      total,
				Success:    success,
				Failure:    failure,
			}
		}
	}

	return APIResponse{
		DomainName:      cfg.DomainName,
		TenantID:        tenantID,
		Timestamp:       ts,
		Windows:         windowData,
		Rates30min:      rate30min,
		Rates1hr:        rate1hr,
		Rates1d:         rate1d,
		Rates7d:         rate7d,
		Rates30d:        rate30d,
		SelectedRate:    selectedRate,
		RecentFailed:    recentFailed,
		TotalFailed:     totalFailed,
		TasklistLatency: tasklistLatency,
		ActivityErrors:  activityErrors,
		P100ByWorkflow:  p100ByWorkflow,
	}, totalFailed
}

// computeRateData derives success/failure rates for a longer window from the WindowData.
// Failure is the sum of failed + timedOut counts.
func computeRateData(windowData []WindowData, idx int) RateData {
	if idx >= len(windowData) {
		return RateData{}
	}
	w := windowData[idx]
	total := w.Started
	failure := w.Failed + w.TimedOut
	success := total - failure

	return RateData{
		Total:      total,
		Success:    success,
		Failure:    failure,
		SuccessPct: formatPercentage(success, total),
		FailurePct: formatPercentage(failure, total),
	}
}

// ============================================================
// HTTP Handlers
// ============================================================

// corsMiddleware wraps an http.HandlerFunc with CORS headers.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

// parseActivityErrorStatusFilter converts a status filter query parameter for activity errors
// to a slice of int conditions. Special codes: -1 = open, -2 = closed, other values = CloseStatus.
// Accepts: open, closed, failed, completed, cancelled, terminated, timeout, continuedasnew
func parseActivityErrorStatusFilter(filter string) []int {
	if filter == "" {
		return nil // no filter => show all statuses in the ES activity summary
	}

	statusMap := map[string]int{
		"open":           -1,
		"closed":         -2,
		"completed":      0,
		"failed":         1,
		"cancelled":      2,
		"canceled":       2,
		"terminated":     3,
		"continuedasnew": 4,
		"timeout":        5,
		"timedout":       5,
	}

	seen := make(map[int]bool)
	var result []int
	for _, s := range strings.Split(filter, ",") {
		s = strings.TrimSpace(s)
		s = strings.ToLower(s)
		s = strings.ReplaceAll(s, " ", "")
		s = strings.ReplaceAll(s, "_", "")
		if code, ok := statusMap[s]; ok && !seen[code] {
			seen[code] = true
			result = append(result, code)
		}
	}

	// If both open and closed are selected, it's equivalent to no filter (all workflows)
	if seen[-1] && seen[-2] {
		return nil
	}

	return result
}

// parseStatusFilter converts a status filter query parameter (e.g. "Failed,TimedOut") to
// a slice of ES CloseStatus integer values. If the string is empty, returns [1, 5] (both).
func parseStatusFilter(filter string) []int {
	if filter == "" {
		return []int{1, 5} // default: Failed + TimedOut
	}

	statusMap := map[string]int{
		"failed":   1,
		"timedout": 5,
	}

	seen := make(map[int]bool)
	var result []int
	for _, s := range strings.Split(filter, ",") {
		s = strings.TrimSpace(s)
		s = strings.ToLower(s)
		s = strings.ReplaceAll(s, " ", "") // remove spaces ("Timed Out" -> "timedout")
		if code, ok := statusMap[s]; ok && !seen[code] {
			seen[code] = true
			result = append(result, code)
		}
	}

	if len(result) == 0 {
		return []int{1, 5} // default if nothing matched
	}
	return result
}

func workflowsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse limit from query string
	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed >= 1 && parsed <= 500 {
			limit = parsed
		}
	}

	// Parse tasklist_window from query string (in seconds)
	tasklistWindow := int64(3600) // default 1 hour
	if twStr := r.URL.Query().Get("tasklist_window"); twStr != "" {
		if tw, err := strconv.Atoi(twStr); err == nil && tw >= 300 && tw <= 86400 {
			tasklistWindow = int64(tw)
		}
	}

	// Parse status_filter from query string (comma-separated: "Failed,TimedOut")
	statusFilterStr := r.URL.Query().Get("status_filter")
	statusFilter := parseStatusFilter(statusFilterStr)

	// Parse tasklist_filter from query string (comma-separated tasklist names)
	tasklistFilter := []string{}
	if tfStr := r.URL.Query().Get("tasklist_filter"); tfStr != "" {
		for _, s := range strings.Split(tfStr, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				tasklistFilter = append(tasklistFilter, s)
			}
		}
	}

	// Parse start_time from query string (Unix timestamp in seconds)
	var fromNanos int64
	if stStr := r.URL.Query().Get("start_time"); stStr != "" {
		if st, err := strconv.ParseInt(stStr, 10, 64); err == nil && st > 0 {
			fromNanos = st * 1_000_000_000
		}
	}

	// Parse end_time from query string (Unix timestamp in seconds)
	var toNanos int64
	if etStr := r.URL.Query().Get("end_time"); etStr != "" {
		if et, err := strconv.ParseInt(etStr, 10, 64); err == nil && et > 0 {
			toNanos = et * 1_000_000_000
		}
	}

	// Parse offset from query string
	offset := 0
	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if parsed, err := strconv.Atoi(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// Parse activity_status_filter from query string for activity errors (comma-separated)
	activityStatusFilterStr := r.URL.Query().Get("activity_status_filter")
	activityStatusConditions := parseActivityErrorStatusFilter(activityStatusFilterStr)
	useStoredActivityBreakdown := activityStatusUsesStoredBreakdown(activityStatusConditions)

	// Parse tenant_id from query string
	tenantIDStr := r.URL.Query().Get("tenant_id")
	var tenantID int
	if tenantIDStr != "" {
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}
	}

	// Load tenant from database
	var tenant *Tenant
	var err error

	if tenantID > 0 {
		tenant, err = tenantStore.GetByID(tenantID)
		if err != nil {
			log.Printf("ERROR: failed to load tenant %d: %v", tenantID, err)
			writeJSONError(w, fmt.Sprintf("failed to load tenant: %v", err), http.StatusInternalServerError)
			return
		}
		if tenant == nil {
			writeJSONError(w, fmt.Sprintf("tenant %d not found", tenantID), http.StatusNotFound)
			return
		}
	} else {
		// No tenant_id specified: return the first tenant
		tenants, err := tenantStore.List()
		if err != nil {
			log.Printf("ERROR: failed to list tenants: %v", err)
			writeJSONError(w, fmt.Sprintf("failed to list tenants: %v", err), http.StatusInternalServerError)
			return
		}
		if len(tenants) == 0 {
			writeJSONError(w, "no tenants configured", http.StatusNotFound)
			return
		}
		tenant = &tenants[0]
	}

	cfg := tenantESConfig(tenant)

	activityErrorField := ""
	if !useStoredActivityBreakdown {
		activityErrorField = "WorkflowType"
	}

	// Query Elasticsearch live for dashboard metrics. For general activity status filters we
	// keep the old ES workflow-type counts; for Failed/TimedOut-only filters we swap in the
	// stored Cadence history breakdown below.
	msResp, err := queryElasticsearch(cfg, limit, tasklistWindow, statusFilter, tasklistFilter, fromNanos, toNanos, offset, activityErrorField, activityStatusConditions, "")
	if err != nil {
		log.Printf("ERROR: ES query failed: %v", err)
		writeJSONError(w, fmt.Sprintf("ES query failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Build the response
	apiResp, _ := buildResponse(cfg, tenant.ID, msResp, limit, statusFilter, activityErrorField, "", tasklistWindow)
	if useStoredActivityBreakdown {
		storedActivityErrors, err := loadStoredActivityErrors(r.Context(), tenant.ID, tasklistWindow, fromNanos, toNanos, tasklistFilter, activityStatusConditions)
		if err != nil {
			log.Printf("ERROR: load stored activity errors tenant %d: %v", tenant.ID, err)
			writeJSONError(w, fmt.Sprintf("load stored activity errors: %v", err), http.StatusInternalServerError)
			return
		}
		apiResp.ActivityErrors = storedActivityErrors
		apiResp.ActivityErrorsProcessedCount = sumActivityErrorCounts(storedActivityErrors)
		if apiResp.TotalFailed > apiResp.ActivityErrorsProcessedCount {
			apiResp.ActivityErrorsPendingCount = apiResp.TotalFailed - apiResp.ActivityErrorsProcessedCount
			apiResp.ActivityErrorsPending = true
		}
	}

	recentHits := recentWorkflowHitsFromMultiSearch(msResp)
	if len(recentHits) > 0 {
		// Detach queue preparation from the HTTP request so request cancellation
		// does not interrupt the lookup/enqueue pre-checks.
		enrichCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		queueWorkflowFailureEnrichment(enrichCtx, tenant, recentHits)
		cancel()
	}

	// Serialize and write
	writeJSON(w, apiResp, http.StatusOK)
}

// tenantsHandler handles GET (list) and POST (create) on /api/tenants.
func tenantsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenants, err := tenantStore.List()
		if err != nil {
			log.Printf("ERROR: list tenants: %v", err)
			writeJSONError(w, fmt.Sprintf("list tenants: %v", err), http.StatusInternalServerError)
			return
		}
		if tenants == nil {
			tenants = []Tenant{}
		}

		// Filter tenants by the user's RBAC assignments
		userEmail := getUserEmailFromRequest(r)
		var filtered []Tenant
		for _, t := range tenants {
			var role string
			err := db.QueryRow(`SELECT role FROM rbac WHERE user_email = $1 AND tenant_id = $2`, userEmail, t.ID).Scan(&role)
			if err == nil {
				filtered = append(filtered, t)
			}
		}
		if filtered == nil {
			filtered = []Tenant{}
		}
		writeJSON(w, filtered, http.StatusOK)

	case http.MethodPost:
		var req struct {
			Name            string `json:"name"`
			DomainID        string `json:"domain_id"`
			DomainName      string `json:"domain_name"`
			ESEndpoint      string `json:"es_endpoint"`
			ESIndex         string `json:"es_index"`
			ESApiKey        string `json:"es_api_key"`
			AudienceURL     string `json:"audience_url"`
			NotifyHubURL    string `json:"notifyhub_url"`
			NotifyHubAPIKey string `json:"notifyhub_api_key"`
			CadenceWebURL   string `json:"cadence_web_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			writeJSONError(w, "name is required", http.StatusBadRequest)
			return
		}

		if req.DomainID == "" {
			writeJSONError(w, "domain_id is required", http.StatusBadRequest)
			return
		}
		if req.DomainName == "" {
			writeJSONError(w, "domain_name is required", http.StatusBadRequest)
			return
		}

		// Use defaults for empty fields
		if req.ESEndpoint == "" {
			req.ESEndpoint = "http://localhost:9000"
		}
		if req.ESIndex == "" {
			req.ESIndex = "cadence-visibility"
		}

		tenant, err := tenantStore.Create(req.Name, req.DomainID, req.DomainName, req.ESEndpoint, req.ESIndex, req.ESApiKey, req.AudienceURL, req.NotifyHubURL, req.NotifyHubAPIKey, req.CadenceWebURL)
		if err != nil {
			log.Printf("ERROR: create tenant: %v", err)
			writeJSONError(w, fmt.Sprintf("failed to create tenant: %v", err), http.StatusInternalServerError)
			return
		}

		// Grant the creating user access to the new tenant via RBAC
		userEmail := getUserEmailFromRequest(r)
		if userEmail != "" {
			// Determine the user's role — if they are an admin anywhere, grant admin on the new tenant
			newRole := "admin"
			newPerms := []string{
				"admin", "overview", "failures", "activity-errors", "p100-latency",
				"ses", "pipeline-requests", "notifications", "report-history", "peoples",
			}

			db.Exec(`
				INSERT INTO rbac (user_email, tenant_id, role, permissions, updated_at, last_activity)
				VALUES ($1, $2, $3, $4, NOW(), NOW())
				ON CONFLICT (user_email, tenant_id) DO NOTHING`,
				userEmail, tenant.ID, newRole, pq.Array(newPerms))
		}

		writeJSON(w, tenant, http.StatusCreated)

	case http.MethodPut:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(idStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		var req struct {
			Name            string `json:"name"`
			DomainID        string `json:"domain_id"`
			DomainName      string `json:"domain_name"`
			ESEndpoint      string `json:"es_endpoint"`
			ESIndex         string `json:"es_index"`
			ESApiKey        string `json:"es_api_key"`
			AudienceURL     string `json:"audience_url"`
			NotifyHubURL    string `json:"notifyhub_url"`
			NotifyHubAPIKey string `json:"notifyhub_api_key"`
			CadenceWebURL   string `json:"cadence_web_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		// Use existing values for empty fields
		existing, err := tenantStore.GetByID(tenantID)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
			return
		}
		if existing == nil {
			writeJSONError(w, "tenant not found", http.StatusNotFound)
			return
		}

		if req.Name == "" {
			req.Name = existing.Name
		}
		if req.DomainID == "" {
			req.DomainID = existing.DomainID
		}
		if req.DomainName == "" {
			req.DomainName = existing.DomainName
		}
		if req.ESEndpoint == "" {
			req.ESEndpoint = existing.ESEndpoint
		}
		if req.ESIndex == "" {
			req.ESIndex = existing.ESIndex
		}

		updated, err := tenantStore.Update(tenantID, req.Name, req.DomainID, req.DomainName, req.ESEndpoint, req.ESIndex, req.ESApiKey, req.AudienceURL, req.NotifyHubURL, req.NotifyHubAPIKey, req.CadenceWebURL)
		if err != nil {
			log.Printf("ERROR: update tenant %d: %v", tenantID, err)
			writeJSONError(w, fmt.Sprintf("failed to update tenant: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, updated, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// tenantDeleteHandler handles DELETE on /api/tenants?id=X.
func tenantDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeJSONError(w, "missing id query parameter", http.StatusBadRequest)
		return
	}

	var id int
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
		writeJSONError(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := tenantStore.Delete(id); err != nil {
		log.Printf("ERROR: delete tenant %d: %v", id, err)
		writeJSONError(w, fmt.Sprintf("delete tenant: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "deleted"}, http.StatusOK)
}

// healthHandler is a simple health-check endpoint.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"}, http.StatusOK)
}

// ============================================================
// Helpers
// ============================================================

// writeJSON serializes the given data as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("ERROR: failed to write JSON response: %v", err)
	}
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, message string, statusCode int) {
	writeJSON(w, map[string]string{"error": message}, statusCode)
}

// ============================================================
// Codefac RCA Ingestion
// ============================================================

func codefacIngestToken() string {
	return strings.TrimSpace(getEnv("CODEFAC_RCA_INGEST_TOKEN", ""))
}

func matchesSecret(provided, expected string) bool {
	if provided == "" || expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func authorizeCodefacIngest(r *http.Request) bool {
	expected := codefacIngestToken()
	if expected == "" {
		return false
	}

	if matchesSecret(strings.TrimSpace(r.Header.Get("X-Codefac-Token")), expected) {
		return true
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		if matchesSecret(token, expected) {
			return true
		}
	}

	return false
}

func parseIngestTime(raw string) (*time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return &parsed, nil
		}
	}

	if unixValue, err := strconv.ParseInt(trimmed, 10, 64); err == nil && unixValue > 0 {
		switch {
		case unixValue > 1e17:
			parsed := time.Unix(0, unixValue)
			return &parsed, nil
		case unixValue > 1e14:
			parsed := time.Unix(0, unixValue*1000)
			return &parsed, nil
		case unixValue > 1e11:
			parsed := time.UnixMilli(unixValue)
			return &parsed, nil
		default:
			parsed := time.Unix(unixValue, 0)
			return &parsed, nil
		}
	}

	return nil, fmt.Errorf("unsupported timestamp %q", raw)
}

func parseOpenMRValue(raw string) (string, string) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value, value
	}
	return "", value
}

func normalizeReviewLinkFields(req *codefacRCAIngestRequest) {
	if req == nil {
		return
	}
	req.OpenMRURL = firstNonEmpty(
		req.OpenMRURL,
		req.MRURL,
		req.PRURL,
		req.MergeRequestURL,
		req.PullRequestURL,
	)
	req.OpenMRLabel = firstNonEmpty(
		req.OpenMRLabel,
		req.MRLabel,
		req.PRLabel,
		req.MergeRequestLabel,
		req.PullRequestLabel,
	)
	if req.OpenMRLabel == "" && req.OpenMRURL != "" {
		req.OpenMRLabel = "Open MR/PR"
	}
}

func joinSectionLines(lines []string) string {
	trimmed := make([]string, 0, len(lines))
	for _, line := range lines {
		value := strings.TrimSpace(line)
		if value == "" {
			if len(trimmed) == 0 || trimmed[len(trimmed)-1] == "" {
				continue
			}
			trimmed = append(trimmed, "")
			continue
		}
		trimmed = append(trimmed, value)
	}
	return strings.TrimSpace(strings.Join(trimmed, "\n"))
}

func mergeRawRCAIntoRequest(req *codefacRCAIngestRequest) {
	raw := strings.TrimSpace(req.RawReport)
	if raw == "" {
		return
	}

	sectionLines := map[string][]string{
		"summary":        {},
		"customerImpact": {},
		"rootCause":      {},
		"remediation":    {},
		"currentStatus":  {},
	}
	currentSection := ""

	for _, rawLine := range strings.Split(raw, "\n") {
		line := strings.TrimRight(rawLine, "\r\t ")
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)

		switch lower {
		case "summary":
			currentSection = "summary"
			continue
		case "customer impact":
			currentSection = "customerImpact"
			continue
		case "root cause":
			currentSection = "rootCause"
			continue
		case "remediation":
			currentSection = "remediation"
			continue
		case "current status":
			currentSection = "currentStatus"
			continue
		}

		if strings.HasPrefix(lower, "sent using codefac") {
			currentSection = ""
			continue
		}

		if currentSection != "" {
			sectionLines[currentSection] = append(sectionLines[currentSection], line)
			continue
		}

		switch {
		case strings.HasPrefix(lower, "rca:"):
			req.Title = firstNonEmpty(req.Title, strings.TrimSpace(trimmed[4:]))
		case strings.HasPrefix(lower, "domain:"):
			domain := strings.TrimSpace(trimmed[len("Domain:"):])
			req.Domain = firstNonEmpty(req.Domain, domain)
			req.DomainName = firstNonEmpty(req.DomainName, domain)
		case strings.HasPrefix(lower, "event id:"):
			req.EventID = firstNonEmpty(req.EventID, strings.TrimSpace(trimmed[len("Event ID:"):]))
		case strings.HasPrefix(lower, "run id:"):
			req.RunID = firstNonEmpty(req.RunID, strings.TrimSpace(trimmed[len("Run ID:"):]))
		case strings.HasPrefix(lower, "workflow:"):
			req.WorkflowType = firstNonEmpty(req.WorkflowType, strings.TrimSpace(trimmed[len("Workflow:"):]))
		case strings.HasPrefix(lower, "open mr:"):
			mrURL, mrLabel := parseOpenMRValue(strings.TrimSpace(trimmed[len("Open MR:"):]))
			req.OpenMRURL = firstNonEmpty(req.OpenMRURL, mrURL)
			req.OpenMRLabel = firstNonEmpty(req.OpenMRLabel, mrLabel)
		case strings.HasPrefix(lower, "open pr:"):
			prURL, prLabel := parseOpenMRValue(strings.TrimSpace(trimmed[len("Open PR:"):]))
			req.OpenMRURL = firstNonEmpty(req.OpenMRURL, prURL)
			req.OpenMRLabel = firstNonEmpty(req.OpenMRLabel, prLabel)
		case strings.HasPrefix(lower, "open merge request:"):
			mrURL, mrLabel := parseOpenMRValue(strings.TrimSpace(trimmed[len("Open Merge Request:"):]))
			req.OpenMRURL = firstNonEmpty(req.OpenMRURL, mrURL)
			req.OpenMRLabel = firstNonEmpty(req.OpenMRLabel, mrLabel)
		case strings.HasPrefix(lower, "open pull request:"):
			prURL, prLabel := parseOpenMRValue(strings.TrimSpace(trimmed[len("Open Pull Request:"):]))
			req.OpenMRURL = firstNonEmpty(req.OpenMRURL, prURL)
			req.OpenMRLabel = firstNonEmpty(req.OpenMRLabel, prLabel)
		}
	}

	req.Summary = firstNonEmpty(req.Summary, joinSectionLines(sectionLines["summary"]))
	req.CustomerImpact = firstNonEmpty(req.CustomerImpact, joinSectionLines(sectionLines["customerImpact"]))
	if len(req.CustomerImpactItems) == 0 {
		req.CustomerImpactItems = normalizeImpactItems(sectionLines["customerImpact"])
	}
	req.RootCause = firstNonEmpty(req.RootCause, joinSectionLines(sectionLines["rootCause"]))
	req.Remediation = firstNonEmpty(req.Remediation, joinSectionLines(sectionLines["remediation"]))
	req.CurrentStatus = firstNonEmpty(req.CurrentStatus, joinSectionLines(sectionLines["currentStatus"]))
	normalizeReviewLinkFields(req)
}

func formatCodefacRCAReport(req codefacRCAIngestRequest) string {
	parts := make([]string, 0, 24)
	if title := firstNonEmpty(req.Title); title != "" {
		parts = append(parts, "RCA: "+title)
	}
	if domain := firstNonEmpty(req.DomainName, req.Domain); domain != "" {
		parts = append(parts, "Domain: "+domain)
	}
	if req.EventID != "" {
		parts = append(parts, "Event ID: "+req.EventID)
	}
	if req.RunID != "" {
		parts = append(parts, "Run ID: "+req.RunID)
	}
	if req.WorkflowType != "" {
		parts = append(parts, "Workflow: "+req.WorkflowType)
	}
	if label := firstNonEmpty(req.OpenMRLabel, req.OpenMRURL); label != "" {
		parts = append(parts, "Open MR: "+label)
	}

	appendSection := func(title, body string) {
		body = strings.TrimSpace(body)
		if body == "" {
			return
		}
		parts = append(parts, "", title, body)
	}

	appendSection("Summary", req.Summary)
	if len(req.CustomerImpactItems) > 0 {
		bullets := make([]string, 0, len(req.CustomerImpactItems))
		for _, item := range normalizeImpactItems(req.CustomerImpactItems) {
			bullets = append(bullets, "- "+item)
		}
		appendSection("Customer Impact", strings.Join(bullets, "\n"))
	} else {
		appendSection("Customer Impact", req.CustomerImpact)
	}
	appendSection("Root Cause", req.RootCause)
	appendSection("Remediation", req.Remediation)
	appendSection("Current Status", req.CurrentStatus)

	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func lookupTenantByDomainIdentifier(identifier string) (*Tenant, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return nil, sql.ErrNoRows
	}

	var tenant Tenant
	err := db.QueryRow(`
		SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url, notifyhub_url, notifyhub_api_key, cadence_web_url, created_at, updated_at
		FROM tenants
		WHERE domain_name = $1 OR domain_id = $1 OR name = $1
		ORDER BY id
		LIMIT 1`,
		identifier,
	).Scan(
		&tenant.ID,
		&tenant.Name,
		&tenant.DomainID,
		&tenant.DomainName,
		&tenant.ESEndpoint,
		&tenant.ESIndex,
		&tenant.ESApiKey,
		&tenant.AudienceURL,
		&tenant.NotifyHubURL,
		&tenant.NotifyHubAPIKey,
		&tenant.CadenceWebURL,
		&tenant.CreatedAt,
		&tenant.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

func storeWorkflowRCAReport(ctx context.Context, tenantID int, req codefacRCAIngestRequest) error {
	raisedAt, err := parseIngestTime(req.RaisedAt)
	if err != nil {
		return err
	}
	workflowStartedAt, err := parseIngestTime(req.WorkflowStartedAt)
	if err != nil {
		return err
	}
	failedAt, err := parseIngestTime(req.FailedAt)
	if err != nil {
		return err
	}

	source := firstNonEmpty(req.Source, "codefac")
	customerImpactItems := normalizeImpactItems(req.CustomerImpactItems)
	customerImpactDetails := firstNonEmpty(req.CustomerImpact, strings.Join(customerImpactItems, "\n"))
	customerImpactSummary := summarizeImpact(customerImpactItems, customerImpactDetails)
	rawReport := strings.TrimSpace(req.RawReport)
	if rawReport == "" {
		rawReport = formatCodefacRCAReport(req)
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO workflow_rca_reports (
			tenant_id, source, event_id, workflow_id, run_id, workflow_type,
			title, summary, customer_impact_summary, customer_impact_details,
			customer_impact_items, root_cause, remediation, current_status,
			open_mr_url, open_mr_label, raw_report, raised_at, workflow_started_at,
			failed_at, received_at, updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13, $14,
			$15, $16, $17, $18, $19,
			$20, NOW(), NOW()
		)
		ON CONFLICT (tenant_id, run_id) DO UPDATE SET
			source = EXCLUDED.source,
			event_id = EXCLUDED.event_id,
			workflow_id = EXCLUDED.workflow_id,
			workflow_type = EXCLUDED.workflow_type,
			title = EXCLUDED.title,
			summary = EXCLUDED.summary,
			customer_impact_summary = EXCLUDED.customer_impact_summary,
			customer_impact_details = EXCLUDED.customer_impact_details,
			customer_impact_items = EXCLUDED.customer_impact_items,
			root_cause = EXCLUDED.root_cause,
			remediation = EXCLUDED.remediation,
			current_status = EXCLUDED.current_status,
			open_mr_url = EXCLUDED.open_mr_url,
			open_mr_label = EXCLUDED.open_mr_label,
			raw_report = EXCLUDED.raw_report,
			raised_at = EXCLUDED.raised_at,
			workflow_started_at = EXCLUDED.workflow_started_at,
			failed_at = EXCLUDED.failed_at,
			received_at = NOW(),
			updated_at = NOW()`,
		tenantID,
		source,
		strings.TrimSpace(req.EventID),
		strings.TrimSpace(req.WorkflowID),
		strings.TrimSpace(req.RunID),
		strings.TrimSpace(req.WorkflowType),
		strings.TrimSpace(req.Title),
		strings.TrimSpace(req.Summary),
		customerImpactSummary,
		strings.TrimSpace(customerImpactDetails),
		pq.Array(customerImpactItems),
		strings.TrimSpace(req.RootCause),
		strings.TrimSpace(req.Remediation),
		strings.TrimSpace(req.CurrentStatus),
		strings.TrimSpace(req.OpenMRURL),
		strings.TrimSpace(req.OpenMRLabel),
		rawReport,
		raisedAt,
		workflowStartedAt,
		failedAt,
	)
	if err != nil {
		return fmt.Errorf("store workflow rca report: %w", err)
	}
	return nil
}

func codefacRCAIngestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if codefacIngestToken() == "" {
		writeJSONError(w, "codefac rca ingest is not configured", http.StatusServiceUnavailable)
		return
	}
	if !authorizeCodefacIngest(r) {
		writeJSONError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req codefacRCAIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	normalizeReviewLinkFields(&req)
	mergeRawRCAIntoRequest(&req)

	var tenant *Tenant
	var err error
	switch {
	case req.TenantID > 0:
		tenant, err = tenantStore.GetByID(req.TenantID)
	case firstNonEmpty(req.DomainName, req.Domain) != "":
		tenant, err = lookupTenantByDomainIdentifier(firstNonEmpty(req.DomainName, req.Domain))
	default:
		writeJSONError(w, "tenant_id or domain/domain_name is required", http.StatusBadRequest)
		return
	}
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, "tenant not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, fmt.Sprintf("resolve tenant: %v", err), http.StatusInternalServerError)
		return
	}
	if tenant == nil {
		writeJSONError(w, "tenant not found", http.StatusNotFound)
		return
	}

	req.WorkflowID = strings.TrimSpace(req.WorkflowID)
	req.RunID = strings.TrimSpace(req.RunID)
	if req.RunID == "" {
		writeJSONError(w, "run_id is required", http.StatusBadRequest)
		return
	}

	if err := storeWorkflowRCAReport(r.Context(), tenant.ID, req); err != nil {
		if strings.Contains(err.Error(), "unsupported timestamp") {
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSONError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]any{
		"status":      "stored",
		"tenant_id":   tenant.ID,
		"workflow_id": req.WorkflowID,
		"run_id":      req.RunID,
	}, http.StatusAccepted)
}

// ============================================================
// SES Metrics (AWS CloudWatch)
// ============================================================

// getSESCloudWatchConfig returns the SES CloudWatch configuration from environment variables.
func getSESCloudWatchConfig() SESCloudWatchConfig {
	return SESCloudWatchConfig{
		Region:        getEnv("AWS_REGION", "us-east-1"),
		ConfigSetName: getEnv("SES_CONFIG_SET_NAME", ""),
	}
}

// queryCloudWatchSESMetrics queries AWS CloudWatch for SES send, bounce, complaint, and reject metrics.
func queryCloudWatchSESMetrics(ctx context.Context, cfg SESCloudWatchConfig, periodSeconds int32, startTime, endTime time.Time) (*SESMetricsResponse, error) {
	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			getEnv("AWS_ACCESS_KEY_ID", ""),
			getEnv("AWS_SECRET_ACCESS_KEY", ""),
			getEnv("AWS_SESSION_TOKEN", ""),
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}

	cw := cloudwatch.NewFromConfig(awsCfg)

	// Base dimensions (optional config set)
	baseDims := []types.Dimension{}
	if cfg.ConfigSetName != "" {
		baseDims = append(baseDims, types.Dimension{
			Name:  strPtr("ConfigurationSet"),
			Value: strPtr(cfg.ConfigSetName),
		})
	}

	// Sends dimensions
	sendDims := make([]types.Dimension, len(baseDims))
	copy(sendDims, baseDims)

	// Permanent bounces dimensions
	permBounceDims := make([]types.Dimension, len(baseDims)+1)
	copy(permBounceDims, baseDims)
	permBounceDims[len(baseDims)] = types.Dimension{
		Name:  strPtr("BounceType"),
		Value: strPtr("Permanent"),
	}

	// Transient bounces dimensions
	transBounceDims := make([]types.Dimension, len(baseDims)+1)
	copy(transBounceDims, baseDims)
	transBounceDims[len(baseDims)] = types.Dimension{
		Name:  strPtr("BounceType"),
		Value: strPtr("Transient"),
	}

	// Complaints dimensions
	complaintDims := make([]types.Dimension, len(baseDims))
	copy(complaintDims, baseDims)

	// Rejects dimensions
	rejectDims := make([]types.Dimension, len(baseDims))
	copy(rejectDims, baseDims)

	// Helper to query a single metric's aggregate sum
	type metricResult struct {
		name  string
		total float64
		err   error
	}

	querySingle := func(metricName string, dims []types.Dimension, stat string, period int32) metricResult {
		input := &cloudwatch.GetMetricStatisticsInput{
			Namespace:  strPtr("AWS/SES"),
			MetricName: strPtr(metricName),
			Dimensions: dims,
			StartTime:  &startTime,
			EndTime:    &endTime,
			Period:     &period,
			Statistics: []types.Statistic{types.Statistic(stat)},
		}
		out, err := cw.GetMetricStatistics(ctx, input)
		if err != nil {
			return metricResult{name: metricName, err: err}
		}
		var total float64
		for _, dp := range out.Datapoints {
			if dp.Sum != nil {
				total += *dp.Sum
			}
		}
		return metricResult{name: metricName, total: total}
	}

	// Helper to query daily data points
	type dailyResult struct {
		name       string
		datapoints []types.Datapoint
		err        error
	}

	queryDaily := func(metricName string, dims []types.Dimension, stat string) dailyResult {
		dailyPeriod := int32(86400) // 1 day in seconds
		input := &cloudwatch.GetMetricStatisticsInput{
			Namespace:  strPtr("AWS/SES"),
			MetricName: strPtr(metricName),
			Dimensions: dims,
			StartTime:  &startTime,
			EndTime:    &endTime,
			Period:     &dailyPeriod,
			Statistics: []types.Statistic{types.Statistic(stat)},
		}
		out, err := cw.GetMetricStatistics(ctx, input)
		if err != nil {
			return dailyResult{name: metricName, err: err}
		}
		return dailyResult{name: metricName, datapoints: out.Datapoints}
	}

	// Run aggregate queries in parallel
	type aggQuery struct {
		metric string // CloudWatch metric name
		key    string // result key for switch
		dims   []types.Dimension
	}
	aggQueries := []aggQuery{
		{"Send", "sends", sendDims},
		{"Bounce", "bounces", baseDims},
		{"Bounce", "perm_bounces", permBounceDims},
		{"Bounce", "trans_bounces", transBounceDims},
		{"Complaint", "complaints", complaintDims},
		{"Reject", "rejects", rejectDims},
	}

	type aggChanResult struct {
		key   string
		total float64
		err   error
	}
	aggCh := make(chan aggChanResult, len(aggQueries))
	for _, q := range aggQueries {
		go func(metric string, key string, dims []types.Dimension) {
			res := querySingle(metric, dims, "Sum", periodSeconds)
			aggCh <- aggChanResult{key: key, total: res.total, err: res.err}
		}(q.metric, q.key, q.dims)
	}

	resp := &SESMetricsResponse{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		PeriodDays: int(endTime.Sub(startTime).Hours() / 24),
	}

	for i := 0; i < len(aggQueries); i++ {
		res := <-aggCh
		if res.err != nil {
			log.Printf("WARN: SES metric %s query failed: %v", res.key, res.err)
			continue
		}
		val := int64(res.total)
		switch res.key {
		case "sends":
			resp.Sends = val
		case "bounces":
			resp.Bounces = val
		case "perm_bounces":
			resp.PermanentBounces = val
		case "trans_bounces":
			resp.TransientBounces = val
		case "complaints":
			resp.Complaints = val
		case "rejects":
			resp.Rejects = val
		}
	}
	close(aggCh)

	if resp.Bounces == 0 {
		resp.Bounces = resp.PermanentBounces + resp.TransientBounces
	}

	// Calculate rates
	totalSends := resp.Sends
	if totalSends > 0 {
		bounceRate := float64(resp.Bounces) / float64(totalSends) * 100
		complaintRate := float64(resp.Complaints) / float64(totalSends) * 100
		errorRate := float64(resp.Bounces+resp.Complaints+resp.Rejects) / float64(totalSends) * 100

		resp.BounceRate = fmt.Sprintf("%.4f%%", bounceRate)
		resp.ComplaintRate = fmt.Sprintf("%.4f%%", complaintRate)
		resp.ErrorRate = fmt.Sprintf("%.4f%%", errorRate)
	} else {
		resp.BounceRate = "0.0000%"
		resp.ComplaintRate = "0.0000%"
		resp.ErrorRate = "0.0000%"
	}

	// Run daily queries in parallel
	type dailyQuery struct {
		metric string // CloudWatch metric name
		key    string // result key for switch
		dims   []types.Dimension
	}
	dailyQueries := []dailyQuery{
		{"Send", "d_sends", sendDims},
		{"Bounce", "d_bounces", baseDims},
		{"Complaint", "d_complaints", complaintDims},
	}

	type dailyChanResult struct {
		key        string
		datapoints []types.Datapoint
		err        error
	}
	dailyCh := make(chan dailyChanResult, len(dailyQueries))
	for _, q := range dailyQueries {
		go func(metric string, key string, dims []types.Dimension) {
			res := queryDaily(metric, dims, "Sum")
			dailyCh <- dailyChanResult{key: key, datapoints: res.datapoints, err: res.err}
		}(q.metric, q.key, q.dims)
	}

	// Parse daily breakdown
	dayMap := make(map[string]*SESDailyVolume)
	for i := 0; i < len(dailyQueries); i++ {
		res := <-dailyCh
		if res.err != nil {
			log.Printf("WARN: failed to get daily SES data for %s: %v", res.key, res.err)
			continue
		}
		var keyPrefix string
		switch res.key {
		case "d_sends":
			keyPrefix = "sends"
		case "d_bounces":
			keyPrefix = "bounces"
		case "d_complaints":
			keyPrefix = "complaints"
		}
		for _, dp := range res.datapoints {
			if dp.Timestamp == nil || dp.Sum == nil {
				continue
			}
			dateKey := dp.Timestamp.UTC().Format("2006-01-02")
			if _, ok := dayMap[dateKey]; !ok {
				dayMap[dateKey] = &SESDailyVolume{Date: dateKey}
			}
			v := int64(*dp.Sum)
			switch keyPrefix {
			case "sends":
				dayMap[dateKey].Sends = v
			case "bounces":
				dayMap[dateKey].Bounces = v
			case "complaints":
				dayMap[dateKey].Complaints = v
			}
		}
	}
	close(dailyCh)

	// Sort by date
	var dates []string
	for d := range dayMap {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	for _, d := range dates {
		resp.DailyVolume = append(resp.DailyVolume, *dayMap[d])
	}

	return resp, nil
}

// getSESRegions returns the list of configured SES regions from the environment.
func getSESRegions() []string {
	regionsStr := getEnv("SES_REGIONS", "")
	if regionsStr == "" {
		// Default to the single configured region
		return []string{getEnv("AWS_REGION", "us-east-1")}
	}
	regions := strings.Split(regionsStr, ",")
	for i := range regions {
		regions[i] = strings.TrimSpace(regions[i])
	}
	return regions
}

// sesRegionsHandler handles GET /api/ses-regions.
func sesRegionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	regions := getSESRegions()
	writeJSON(w, map[string]interface{}{"regions": regions}, http.StatusOK)
}

// sesMetricsHandler handles GET /api/ses-metrics.
func sesMetricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse optional query params
	query := r.URL.Query()

	// Default to last 7 days
	endTime := time.Now().UTC()
	startTime := endTime.AddDate(0, 0, -7)

	if ds := query.Get("days"); ds != "" {
		if days, err := strconv.Atoi(ds); err == nil && days > 0 && days <= 90 {
			startTime = endTime.AddDate(0, 0, -days)
		}
	}

	if ph := query.Get("period_hours"); ph != "" {
		if hours, err := strconv.Atoi(ph); err == nil && hours > 0 && hours <= 2160 {
			startTime = endTime.Add(-time.Duration(hours) * time.Hour)
		}
	}

	if st := query.Get("start_time"); st != "" {
		if ts, err := strconv.ParseInt(st, 10, 64); err == nil {
			startTime = time.Unix(ts, 0).UTC()
		}
	}

	if et := query.Get("end_time"); et != "" {
		if ts, err := strconv.ParseInt(et, 10, 64); err == nil {
			endTime = time.Unix(ts, 0).UTC()
		}
	}

	// Use region from query param, fall back to env
	region := query.Get("region")
	if region == "" {
		region = getEnv("AWS_REGION", "us-east-1")
	}

	// Try cache first for this region
	if val, ok := sesCache.Load(region); ok {
		entry := val.(*sesCacheEntry)
		entry.mu.RLock()
		data := entry.Data
		entry.mu.RUnlock()
		if data != nil {
			writeJSON(w, data, http.StatusOK)
			return
		}
	}

	sesCfg := getSESCloudWatchConfig()
	sesCfg.Region = region

	// Calculate appropriate CloudWatch period based on time range duration
	duration := endTime.Sub(startTime)
	var periodSeconds int32
	switch {
	case duration <= 2*time.Hour:
		periodSeconds = 60 // 1 minute
	case duration <= 12*time.Hour:
		periodSeconds = 300 // 5 minutes
	case duration <= 48*time.Hour:
		periodSeconds = 3600 // 1 hour
	default:
		periodSeconds = 86400 // 1 day
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := queryCloudWatchSESMetrics(ctx, sesCfg, periodSeconds, startTime, endTime)
	if err != nil {
		log.Printf("ERROR: ses metrics query: %v", err)
		writeJSONError(w, fmt.Sprintf("ses metrics: %v", err), http.StatusInternalServerError)
		return
	}

	result.DomainName = getEnv("SES_DOMAIN_NAME", "ses")

	writeJSON(w, result, http.StatusOK)
}

// sesDebugHandler lists available SES metrics in CloudWatch for debugging.
func sesDebugHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	region := r.URL.Query().Get("region")
	if region == "" {
		region = getEnv("AWS_REGION", "us-east-1")
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			getEnv("AWS_ACCESS_KEY_ID", ""),
			getEnv("AWS_SECRET_ACCESS_KEY", ""),
			getEnv("AWS_SESSION_TOKEN", ""),
		)),
	)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("load AWS config: %v", err), http.StatusInternalServerError)
		return
	}

	cw := cloudwatch.NewFromConfig(awsCfg)

	var allMetrics []map[string]interface{}
	var nextToken *string

	for {
		out, err := cw.ListMetrics(ctx, &cloudwatch.ListMetricsInput{
			Namespace: strPtr("AWS/SES"),
			NextToken: nextToken,
		})
		if err != nil {
			writeJSONError(w, fmt.Sprintf("list metrics: %v", err), http.StatusInternalServerError)
			return
		}

		for _, m := range out.Metrics {
			dims := make([]map[string]string, 0)
			for _, d := range m.Dimensions {
				if d.Name != nil && d.Value != nil {
					dims = append(dims, map[string]string{*d.Name: *d.Value})
				}
			}
			mn := ""
			if m.MetricName != nil {
				mn = *m.MetricName
			}
			allMetrics = append(allMetrics, map[string]interface{}{
				"metric_name": mn,
				"namespace":   "AWS/SES",
				"dimensions":  dims,
			})
		}

		if out.NextToken == nil || *out.NextToken == "" {
			break
		}
		nextToken = out.NextToken
	}

	writeJSON(w, map[string]interface{}{
		"region":  region,
		"metrics": allMetrics,
		"count":   len(allMetrics),
	}, http.StatusOK)
}

// Helper: string pointer
func strPtr(s string) *string {
	return &s
}

// Helper: bool pointer
func boolPtr(b bool) *bool {
	return &b
}

// ============================================================
// RBAC Handlers
// ============================================================

var adminKeyOnce sync.Once
var adminKeyUsed bool

// rbacSetupAdminHandler handles POST /api/rbac/setup-admin.
// It uses a one-time ADMIN_KEY to set up the first admin user.
// The ADMIN_KEY environment variable must match, and no admin must exist yet.
func rbacSetupAdminHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AdminKey  string `json:"admin_key"`
		UserEmail string `json:"user_email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.AdminKey == "" {
		writeJSONError(w, "admin_key is required", http.StatusBadRequest)
		return
	}
	if req.UserEmail == "" {
		writeJSONError(w, "user_email is required", http.StatusBadRequest)
		return
	}

	// Verify admin key
	expectedKey := getEnv("ADMIN_KEY", "")
	if expectedKey == "" {
		writeJSONError(w, "admin setup is not configured or already completed", http.StatusBadRequest)
		return
	}
	if req.AdminKey != expectedKey {
		writeJSONError(w, "invalid admin_key", http.StatusUnauthorized)
		return
	}

	// Check the user's session exists
	// We need to allow this without requiring a session since it's first-time setup
	// But we do need to validate the user exists in the sessions map
	// Use a simple existence check - the user must have signed in at least once
	found := false
	sessions.Range(func(k, v any) bool {
		s := v.(session)
		if s.Email == req.UserEmail {
			found = true
			return false
		}
		return true
	})
	if !found {
		writeJSONError(w, "user has not signed in yet. ask them to sign in first.", http.StatusBadRequest)
		return
	}

	// Create admin with all permissions (including "admin" for the Clients page)
	allPerms := []string{
		"admin", "overview", "failures", "activity-errors", "p100-latency",
		"ses", "pipeline-requests", "notifications", "report-history", "peoples",
	}

	// Get all tenants and create admin for each
	rows, err := db.Query(`SELECT id FROM tenants ORDER BY id`)
	if err != nil {
		log.Printf("ERROR: list tenants: %v", err)
		writeJSONError(w, "list tenants failed", http.StatusInternalServerError)
		return
	}

	tenantIDs := []int{}
	for rows.Next() {
		var tid int
		if err := rows.Scan(&tid); err != nil {
			continue
		}
		tenantIDs = append(tenantIDs, tid)
	}
	rows.Close()

	// If no tenants exist, create a default one so the admin can be set up.
	if len(tenantIDs) == 0 {
		name := getEnv("DEFAULT_TENANT_NAME", "Default")
		domainID := getEnv("DEFAULT_DOMAIN_ID", "")
		domainName := getEnv("DEFAULT_DOMAIN_NAME", "unknown")
		esEndpoint := getEnv("DEFAULT_ES", "http://localhost:9000")
		esIndex := getEnv("DEFAULT_INDEX", "cadence-visibility")
		esApiKey := getEnv("DEFAULT_ES_API_KEY", "")

		var t Tenant
		err := db.QueryRow(
			`INSERT INTO tenants (name, domain_id, domain_name, es_endpoint, es_index, es_api_key, audience_url)
			 VALUES ($1, $2, $3, $4, $5, $6, '')
			 RETURNING id`,
			name, domainID, domainName, esEndpoint, esIndex, esApiKey).Scan(&t.ID)
		if err != nil {
			log.Printf("ERROR: create default tenant for admin setup: %v", err)
			writeJSONError(w, "failed to create default tenant", http.StatusInternalServerError)
			return
		}
		tenantIDs = append(tenantIDs, t.ID)
		log.Printf("Created default tenant id=%d for admin setup", t.ID)
	}

	createdTenants := []int{}
	for _, tid := range tenantIDs {
		_, err := db.Exec(`
			INSERT INTO rbac (user_email, tenant_id, role, permissions, updated_at, last_activity)
			VALUES ($1, $2, 'admin', $3, NOW(), NOW())
			ON CONFLICT (user_email, tenant_id)
			DO UPDATE SET role = 'admin', permissions = $3, updated_at = NOW(), last_activity = NOW()`,
			req.UserEmail, tid, pq.Array(allPerms))
		if err != nil {
			log.Printf("ERROR: create admin for tenant %d: %v", tid, err)
			continue
		}
		createdTenants = append(createdTenants, tid)
	}

	if len(createdTenants) == 0 {
		log.Printf("ERROR: no tenants found for admin setup")
		writeJSONError(w, "no tenant found", http.StatusInternalServerError)
		return
	}

	log.Printf("ADMIN SETUP COMPLETE: user %q promoted to admin for %d tenant(s): %v", req.UserEmail, len(createdTenants), createdTenants)
	log.Printf("ADMIN_KEY has been invalidated")

	writeJSON(w, map[string]string{
		"status":     "admin_created",
		"user_email": req.UserEmail,
		"role":       "admin",
	}, http.StatusOK)
}

// rbacUsersHandler lists all users who have signed in (via the sessions map) and their RBAC entries.
func rbacUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	// Get current user's role to check if admin
	currentEmail, err := getUserEmail(r)
	if err != nil {
		writeJSONError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Build a map of signed-in users (from sessions), skipping expired sessions
	now := time.Now()
	userSet := make(map[string]session)
	sessions.Range(func(k, v any) bool {
		s := v.(session)
		if now.After(s.Expiry) {
			sessions.Delete(k)
			return true
		}
		userSet[s.Email] = s
		return true
	})

	// Get RBAC entries for this tenant
	rows, err := db.Query(`
		SELECT id, user_email, tenant_id, role, persona, permissions, created_at, updated_at, last_activity
		FROM rbac WHERE tenant_id = $1 ORDER BY user_email`, tenantID)
	if err != nil {
		log.Printf("ERROR: list rbac: %v", err)
		writeJSONError(w, fmt.Sprintf("list: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	rbacMap := make(map[string]RBACEntry)
	for rows.Next() {
		var e RBACEntry
		if err := rows.Scan(&e.ID, &e.UserEmail, &e.TenantID, &e.Role, &e.Persona, pq.Array(&e.Permissions), &e.CreatedAt, &e.UpdatedAt, &e.LastActivity); err != nil {
			log.Printf("ERROR: scan rbac: %v", err)
			continue
		}
		e.Persona = normalizeRBACPersona(e.Persona)
		rbacMap[e.UserEmail] = e
	}

	// Merge: all session users + any RBAC entries for users not currently signed in
	result := make([]map[string]interface{}, 0)
	seen := make(map[string]bool)

	// Add all RBAC entries first
	for _, entry := range rbacMap {
		seen[entry.UserEmail] = true

		// Ensure users with role "admin" always have the "admin" permission.
		perms := entry.Permissions
		if entry.Role == "admin" {
			hasAdmin := false
			for _, p := range perms {
				if p == "admin" {
					hasAdmin = true
					break
				}
			}
			if !hasAdmin {
				perms = append(perms, "admin")
			}
		}

		item := map[string]interface{}{
			"id":            entry.ID,
			"user_email":    entry.UserEmail,
			"tenant_id":     entry.TenantID,
			"role":          entry.Role,
			"persona":       normalizeRBACPersona(entry.Persona),
			"permissions":   perms,
			"signed_in":     false,
			"last_activity": entry.LastActivity,
		}
		if s, ok := userSet[entry.UserEmail]; ok {
			item["name"] = s.Name
			item["picture"] = s.Picture
			item["signed_in"] = true
		}
		result = append(result, item)
	}

	// Add session users without RBAC entries
	for email, s := range userSet {
		if !seen[email] {
			result = append(result, map[string]interface{}{
				"id":            0,
				"user_email":    email,
				"tenant_id":     tenantID,
				"role":          "user",
				"persona":       "developer",
				"permissions":   []string{},
				"signed_in":     true,
				"name":          s.Name,
				"picture":       s.Picture,
				"last_activity": nil,
			})
		}
	}

	// Also get current user's role
	currentRole := "user"
	currentPersona := "developer"
	if entry, ok := rbacMap[currentEmail]; ok {
		currentRole = entry.Role
		currentPersona = normalizeRBACPersona(entry.Persona)
	} else {
		// Check if the sessions map has any admin for this tenant
	}

	writeJSON(w, map[string]interface{}{
		"users":           result,
		"current_user":    currentEmail,
		"current_role":    currentRole,
		"current_persona": currentPersona,
	}, http.StatusOK)
}

// rbacUserTenantsHandler handles GET, POST, and DELETE on /api/rbac/user-tenants.
// GET  /api/rbac/user-tenants?user_email=X — returns all tenants the user has RBAC entries for
// POST /api/rbac/user-tenants — assigns a user to a tenant (admin only)
// DELETE /api/rbac/user-tenants?user_email=X&tenant_id=N — removes a user from a tenant (admin only)
func rbacUserTenantsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		userEmail := r.URL.Query().Get("user_email")
		if userEmail == "" {
			writeJSONError(w, "missing user_email", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
			SELECT t.id, t.name, r.role, r.persona, r.permissions, r.created_at, r.updated_at, r.last_activity
			FROM rbac r
			JOIN tenants t ON t.id = r.tenant_id
			WHERE r.user_email = $1
			ORDER BY t.name`, userEmail)
		if err != nil {
			log.Printf("ERROR: list user tenants: %v", err)
			writeJSONError(w, fmt.Sprintf("list: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type UserTenant struct {
			TenantID     int        `json:"tenant_id"`
			TenantName   string     `json:"tenant_name"`
			Role         string     `json:"role"`
			Persona      string     `json:"persona"`
			Permissions  []string   `json:"permissions"`
			CreatedAt    time.Time  `json:"created_at"`
			UpdatedAt    time.Time  `json:"updated_at"`
			LastActivity *time.Time `json:"last_activity"`
		}

		tenants := make([]UserTenant, 0)
		for rows.Next() {
			var ut UserTenant
			if err := rows.Scan(&ut.TenantID, &ut.TenantName, &ut.Role, &ut.Persona, pq.Array(&ut.Permissions), &ut.CreatedAt, &ut.UpdatedAt, &ut.LastActivity); err != nil {
				log.Printf("ERROR: scan user tenant: %v", err)
				continue
			}
			ut.Persona = normalizeRBACPersona(ut.Persona)
			// Ensure users with role "admin" always have the "admin" permission.
			if ut.Role == "admin" {
				hasAdmin := false
				for _, p := range ut.Permissions {
					if p == "admin" {
						hasAdmin = true
						break
					}
				}
				if !hasAdmin {
					ut.Permissions = append(ut.Permissions, "admin")
				}
			}
			tenants = append(tenants, ut)
		}
		writeJSON(w, tenants, http.StatusOK)

	case http.MethodPost:
		// Assign a user to a tenant -- only admins can do this
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		// Only admins can assign users to tenants
		currentEmail, err := getUserEmail(r)
		if err != nil {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var currentEntry RBACEntry
		err = db.QueryRow(`
			SELECT role FROM rbac WHERE user_email = $1 AND tenant_id = $2`,
			currentEmail, tenantID).Scan(&currentEntry.Role)
		if err == sql.ErrNoRows {
			writeJSONError(w, "only admins can manage user assignments", http.StatusForbidden)
			return
		}
		if err != nil {
			writeJSONError(w, fmt.Sprintf("check role: %v", err), http.StatusInternalServerError)
			return
		}
		if currentEntry.Role != "admin" {
			writeJSONError(w, "only admins can manage user assignments", http.StatusForbidden)
			return
		}

		var req struct {
			UserEmail   string   `json:"user_email"`
			Role        string   `json:"role"`
			Persona     string   `json:"persona"`
			Permissions []string `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
			return
		}
		if req.UserEmail == "" {
			writeJSONError(w, "user_email is required", http.StatusBadRequest)
			return
		}
		if req.Role != "admin" && req.Role != "user" {
			req.Role = "user"
		}
		req.Persona = normalizeRBACPersona(req.Persona)
		if req.Permissions == nil {
			req.Permissions = []string{}
		}

		_, err = db.Exec(`
			INSERT INTO rbac (user_email, tenant_id, role, persona, permissions, updated_at, last_activity)
			VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
			ON CONFLICT (user_email, tenant_id)
			DO UPDATE SET role = $3, persona = $4, permissions = $5, updated_at = NOW(), last_activity = NOW()`,
			req.UserEmail, tenantID, req.Role, req.Persona, pq.Array(req.Permissions))
		if err != nil {
			log.Printf("ERROR: assign user to tenant: %v", err)
			writeJSONError(w, fmt.Sprintf("assign: %v", err), http.StatusInternalServerError)
			return
		}

		log.Printf("USER ASSIGNED: %q to tenant %d with role %q", req.UserEmail, tenantID, req.Role)
		writeJSON(w, map[string]string{"status": "assigned"}, http.StatusOK)

	case http.MethodDelete:
		userEmail := r.URL.Query().Get("user_email")
		tenantIDStr := r.URL.Query().Get("tenant_id")

		if userEmail == "" || tenantIDStr == "" {
			writeJSONError(w, "missing user_email or tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		// Only admins can remove users from tenants
		currentEmail, err := getUserEmail(r)
		if err != nil {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Check admin status for any tenant the current user is an admin of
		var currentEntry RBACEntry
		err = db.QueryRow(`
			SELECT role FROM rbac WHERE user_email = $1 AND tenant_id = $2`,
			currentEmail, tenantID).Scan(&currentEntry.Role)
		if err == sql.ErrNoRows {
			writeJSONError(w, "only admins can manage user assignments", http.StatusForbidden)
			return
		}
		if err != nil {
			writeJSONError(w, fmt.Sprintf("check role: %v", err), http.StatusInternalServerError)
			return
		}
		if currentEntry.Role != "admin" {
			writeJSONError(w, "only admins can manage user assignments", http.StatusForbidden)
			return
		}

		// Cannot remove yourself
		if userEmail == currentEmail {
			writeJSONError(w, "cannot remove yourself from a tenant", http.StatusBadRequest)
			return
		}

		res, err := db.Exec("DELETE FROM rbac WHERE user_email = $1 AND tenant_id = $2", userEmail, tenantID)
		if err != nil {
			log.Printf("ERROR: remove user from tenant: %v", err)
			writeJSONError(w, fmt.Sprintf("remove: %v", err), http.StatusInternalServerError)
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSONError(w, "user is not assigned to this tenant", http.StatusNotFound)
			return
		}

		log.Printf("USER REMOVED: %q from tenant %d", userEmail, tenantID)
		writeJSON(w, map[string]string{"status": "removed"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// rbacHandler handles GET and PUT on /api/rbac.
// GET  /api/rbac?tenant_id=N -- returns the current user's permissions
// PUT  /api/rbac?tenant_id=N -- updates a user's RBAC entry (admin only)
func rbacHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		currentEmail, err := getUserEmail(r)
		if err != nil {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var entry RBACEntry
		err = db.QueryRow(`
			SELECT id, user_email, tenant_id, role, persona, permissions, created_at, updated_at, last_activity
			FROM rbac WHERE user_email = $1 AND tenant_id = $2`,
			currentEmail, tenantID).
			Scan(&entry.ID, &entry.UserEmail, &entry.TenantID, &entry.Role, &entry.Persona, pq.Array(&entry.Permissions), &entry.CreatedAt, &entry.UpdatedAt, &entry.LastActivity)
		if err == sql.ErrNoRows {
			// Return default permissions for new users
			writeJSON(w, map[string]interface{}{
				"user_email":  currentEmail,
				"tenant_id":   tenantID,
				"role":        "user",
				"persona":     "developer",
				"permissions": []string{},
			}, http.StatusOK)
			return
		}
		if err != nil {
			writeJSONError(w, fmt.Sprintf("get rbac: %v", err), http.StatusInternalServerError)
			return
		}

		// Ensure users with role "admin" always have the "admin" permission.
		// This handles existing records that may have been created before "admin"
		// was added to the default permissions list.
		if entry.Role == "admin" {
			hasAdmin := false
			for _, p := range entry.Permissions {
				if p == "admin" {
					hasAdmin = true
					break
				}
			}
			if !hasAdmin {
				entry.Permissions = append(entry.Permissions, "admin")
				// Also persist it so subsequent reads don't need the fix.
				db.Exec(`UPDATE rbac SET permissions = $1, updated_at = NOW() WHERE id = $2`,
					pq.Array(entry.Permissions), entry.ID)
			}
		}
		entry.Persona = normalizeRBACPersona(entry.Persona)

		writeJSON(w, entry, http.StatusOK)

	case http.MethodPut:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		// Only admins can update RBAC
		currentEmail, err := getUserEmail(r)
		if err != nil {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var currentEntry RBACEntry
		err = db.QueryRow(`
			SELECT role FROM rbac WHERE user_email = $1 AND tenant_id = $2`,
			currentEmail, tenantID).Scan(&currentEntry.Role)
		if err == sql.ErrNoRows {
			writeJSONError(w, "only admins can manage permissions", http.StatusForbidden)
			return
		}
		if err != nil {
			writeJSONError(w, fmt.Sprintf("check role: %v", err), http.StatusInternalServerError)
			return
		}
		if currentEntry.Role != "admin" {
			writeJSONError(w, "only admins can manage permissions", http.StatusForbidden)
			return
		}

		var req struct {
			UserEmail   string   `json:"user_email"`
			Role        string   `json:"role"`
			Persona     string   `json:"persona"`
			Permissions []string `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
			return
		}
		if req.UserEmail == "" {
			writeJSONError(w, "user_email is required", http.StatusBadRequest)
			return
		}
		if req.Role != "admin" && req.Role != "user" {
			req.Role = "user"
		}
		req.Persona = normalizeRBACPersona(req.Persona)
		if req.Permissions == nil {
			req.Permissions = []string{}
		}

		var entry RBACEntry
		err = db.QueryRow(`
			INSERT INTO rbac (user_email, tenant_id, role, persona, permissions, updated_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			ON CONFLICT (user_email, tenant_id)
			DO UPDATE SET role = $3, persona = $4, permissions = $5, updated_at = NOW()
			RETURNING id, user_email, tenant_id, role, persona, permissions, created_at, updated_at, last_activity`,
			req.UserEmail, tenantID, req.Role, req.Persona, pq.Array(req.Permissions)).
			Scan(&entry.ID, &entry.UserEmail, &entry.TenantID, &entry.Role, &entry.Persona, pq.Array(&entry.Permissions), &entry.CreatedAt, &entry.UpdatedAt, &entry.LastActivity)
		if err != nil {
			log.Printf("ERROR: upsert rbac: %v", err)
			writeJSONError(w, fmt.Sprintf("save rbac: %v", err), http.StatusInternalServerError)
			return
		}
		entry.Persona = normalizeRBACPersona(entry.Persona)
		writeJSON(w, entry, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// rbacMyAccessHandler handles GET /api/rbac/my-access.
// Returns the current user's access status across all tenants and admin contact info.
func rbacMyAccessHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	currentEmail, err := getUserEmail(r)
	if err != nil {
		writeJSONError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Check if user has any RBAC entries
	var entryCount int
	db.QueryRow(`SELECT COUNT(*) FROM rbac WHERE user_email = $1`, currentEmail).Scan(&entryCount)

	// Get admin contact info (all users with role='admin')
	rows, err := db.Query(`
		SELECT DISTINCT r.user_email FROM rbac r WHERE r.role = 'admin' ORDER BY r.user_email`)
	if err != nil {
		log.Printf("ERROR: list admins: %v", err)
		writeJSONError(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	adminEmails := make([]string, 0)
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			continue
		}
		adminEmails = append(adminEmails, email)
	}

	// Try to get admin names/pictures from sessions
	adminContacts := make([]map[string]interface{}, 0)
	for _, email := range adminEmails {
		contact := map[string]interface{}{
			"email": email,
			"name":  email,
		}
		// Look up in sessions for name/picture
		sessions.Range(func(k, v any) bool {
			s := v.(session)
			if s.Email == email {
				contact["name"] = s.Name
				contact["picture"] = s.Picture
				return false
			}
			return true
		})
		adminContacts = append(adminContacts, contact)
	}

	writeJSON(w, map[string]interface{}{
		"has_access": entryCount > 0,
		"user_email": currentEmail,
		"admins":     adminContacts,
	}, http.StatusOK)
}

// ============================================================
// Alerts Handlers
// ============================================================

// alertsConfigHandler handles GET and PUT on /api/alerts/config.
// GET  /api/alerts/config?tenant_id=N — returns tenant's notifyhub config
// PUT  /api/alerts/config?tenant_id=N — updates tenant's notifyhub config
func alertsConfigHandler(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("tenant_id")
	if idStr == "" {
		writeJSONError(w, "missing tenant_id query parameter", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(idStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		tenant, err := tenantStore.GetByID(tenantID)
		if err != nil {
			log.Printf("ERROR: get tenant %d: %v", tenantID, err)
			writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
			return
		}
		if tenant == nil {
			writeJSONError(w, "tenant not found", http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]string{
			"notifyhub_url":     tenant.NotifyHubURL,
			"notifyhub_api_key": tenant.NotifyHubAPIKey,
		}, http.StatusOK)

	case http.MethodPut:
		var req struct {
			NotifyHubURL    string `json:"notifyhub_url"`
			NotifyHubAPIKey string `json:"notifyhub_api_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		if _, err := db.Exec(`UPDATE tenants SET notifyhub_url=$1, notifyhub_api_key=$2, updated_at=NOW() WHERE id=$3`,
			req.NotifyHubURL, req.NotifyHubAPIKey, tenantID); err != nil {
			log.Printf("ERROR: update tenant %d notifyhub config: %v", tenantID, err)
			writeJSONError(w, fmt.Sprintf("update notifyhub config: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "updated"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// alertsRulesHandler handles CRUD on /api/alerts/rules.
// GET    /api/alerts/rules?tenant_id=N       — list rules
// POST   /api/alerts/rules?tenant_id=N       — create a new rule
// PUT    /api/alerts/rules?id=N              — update an existing rule
// DELETE /api/alerts/rules?id=N              — delete a rule
func alertsRulesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id query parameter", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
					SELECT id, tenant_id, name, enabled, metric_type, condition_type, threshold,
						window_seconds, notification_channel, notification_target, notifyhub_template_id, message_template,
						ses_region, tile_id, alert_type, cooldown_seconds, last_triggered_at, created_at, updated_at
					FROM alert_rules WHERE tenant_id = $1 ORDER BY id ASC`, tenantID)
		if err != nil {
			log.Printf("ERROR: query alert_rules: %v", err)
			writeJSONError(w, fmt.Sprintf("list alert rules: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		rules := make([]AlertRule, 0)
		for rows.Next() {
			var rule AlertRule
			if err := rows.Scan(&rule.ID, &rule.TenantID, &rule.Name, &rule.Enabled,
				&rule.MetricType, &rule.ConditionType, &rule.Threshold,
				&rule.WindowSeconds, &rule.NotificationChannel, &rule.NotificationTarget,
				&rule.NotifyHubTemplateID, &rule.MessageTemplate, &rule.SESRegion, &rule.TileID, &rule.AlertType, &rule.CooldownSeconds, &rule.LastTriggeredAt, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
				log.Printf("ERROR: scan alert_rule: %v", err)
				writeJSONError(w, fmt.Sprintf("scan alert rule: %v", err), http.StatusInternalServerError)
				return
			}
			rules = append(rules, rule)
		}
		if err := rows.Err(); err != nil {
			log.Printf("ERROR: rows iteration: %v", err)
			writeJSONError(w, fmt.Sprintf("read alert rules: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, rules, http.StatusOK)

	case http.MethodPost:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id query parameter", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		var rule AlertRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}
		if rule.Name == "" {
			writeJSONError(w, "name is required", http.StatusBadRequest)
			return
		}

		err := db.QueryRow(`
					INSERT INTO alert_rules (tenant_id, name, enabled, metric_type, condition_type, threshold,
						window_seconds, notification_channel, notification_target, notifyhub_template_id, message_template, ses_region, tile_id, alert_type, cooldown_seconds)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
					RETURNING id, tenant_id, name, enabled, metric_type, condition_type, threshold,
						window_seconds, notification_channel, notification_target, notifyhub_template_id, message_template,
						ses_region, tile_id, alert_type, cooldown_seconds, last_triggered_at, created_at, updated_at`,
			tenantID, rule.Name, rule.Enabled, rule.MetricType, rule.ConditionType, rule.Threshold,
			rule.WindowSeconds, rule.NotificationChannel, rule.NotificationTarget, rule.NotifyHubTemplateID, rule.MessageTemplate, rule.SESRegion, rule.TileID, rule.AlertType, rule.CooldownSeconds).
			Scan(&rule.ID, &rule.TenantID, &rule.Name, &rule.Enabled,
				&rule.MetricType, &rule.ConditionType, &rule.Threshold,
				&rule.WindowSeconds, &rule.NotificationChannel, &rule.NotificationTarget,
				&rule.NotifyHubTemplateID, &rule.MessageTemplate, &rule.SESRegion, &rule.TileID, &rule.AlertType, &rule.CooldownSeconds, &rule.LastTriggeredAt, &rule.CreatedAt, &rule.UpdatedAt)
		if err != nil {
			log.Printf("ERROR: create alert_rule: %v", err)
			writeJSONError(w, fmt.Sprintf("create alert rule: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, rule, http.StatusCreated)

	case http.MethodPut:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id query parameter", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		var rule AlertRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		_, err := db.Exec(`
					UPDATE alert_rules SET
						name=$1, enabled=$2, metric_type=$3, condition_type=$4, threshold=$5,
						window_seconds=$6, notification_channel=$7, notification_target=$8,
						notifyhub_template_id=$9, message_template=$10, ses_region=$11, tile_id=$12, alert_type=$13, cooldown_seconds=$14, updated_at=NOW()
					WHERE id=$15`,
			rule.Name, rule.Enabled, rule.MetricType, rule.ConditionType, rule.Threshold,
			rule.WindowSeconds, rule.NotificationChannel, rule.NotificationTarget,
			rule.NotifyHubTemplateID, rule.MessageTemplate, rule.SESRegion, rule.TileID, rule.AlertType, rule.CooldownSeconds, id)
		if err != nil {
			log.Printf("ERROR: update alert_rule %d: %v", id, err)
			writeJSONError(w, fmt.Sprintf("update alert rule: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "updated"}, http.StatusOK)

	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id query parameter", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		res, err := db.Exec(`DELETE FROM alert_rules WHERE id = $1`, id)
		if err != nil {
			log.Printf("ERROR: delete alert_rule %d: %v", id, err)
			writeJSONError(w, fmt.Sprintf("delete alert rule: %v", err), http.StatusInternalServerError)
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSONError(w, "alert rule not found", http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]string{"status": "deleted"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// codefacPipelinesHandler handles CRUD on /api/codefac-pipelines.
// GET    /api/codefac-pipelines?tenant_id=N       — list pipelines
// POST   /api/codefac-pipelines?tenant_id=N       — create
// PUT    /api/codefac-pipelines?id=N              — update
// DELETE /api/codefac-pipelines?id=N              — delete
func codefacPipelinesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}
		rows, err := db.Query(`
			SELECT id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
				payload_template, cooldown_seconds, enabled, last_triggered_at, created_at, updated_at
							FROM codefac_pipelines WHERE tenant_id = $1 ORDER BY id ASC`, tenantID)
		if err != nil {
			log.Printf("ERROR: list codefac_pipelines: %v", err)
			writeJSONError(w, fmt.Sprintf("list: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		pipelines := make([]CodefacPipeline, 0)
		for rows.Next() {
			var p CodefacPipeline
			if err := rows.Scan(&p.ID, &p.TenantID, &p.Name, &p.PipelineName, &p.MetricType,
				&p.ConditionType, &p.Threshold, &p.PayloadTemplate, &p.CooldownSeconds,
				&p.Enabled, &p.LastTriggeredAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
				log.Printf("ERROR: scan codefac_pipeline: %v", err)
				writeJSONError(w, fmt.Sprintf("scan: %v", err), http.StatusInternalServerError)
				return
			}
			pipelines = append(pipelines, p)
		}
		writeJSON(w, pipelines, http.StatusOK)

	case http.MethodPost:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		var p CodefacPipeline
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}
		if p.Name == "" || p.PipelineName == "" {
			writeJSONError(w, "name and pipeline_name are required", http.StatusBadRequest)
			return
		}
		if p.PayloadTemplate == "" {
			p.PayloadTemplate = "{}"
		}
		err := db.QueryRow(`
					INSERT INTO codefac_pipelines (tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
						payload_template, cooldown_seconds, enabled)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
					RETURNING id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
						payload_template, cooldown_seconds, enabled, last_triggered_at, created_at, updated_at`,
			tenantID, p.Name, p.PipelineName, p.MetricType, p.ConditionType, p.Threshold,
			p.PayloadTemplate, p.CooldownSeconds, p.Enabled).
			Scan(&p.ID, &p.TenantID, &p.Name, &p.PipelineName, &p.MetricType, &p.ConditionType,
				&p.Threshold, &p.PayloadTemplate, &p.CooldownSeconds, &p.Enabled, &p.LastTriggeredAt, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			log.Printf("ERROR: create codefac_pipeline: %v", err)
			writeJSONError(w, fmt.Sprintf("create: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, p, http.StatusCreated)

	case http.MethodPut:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		var p CodefacPipeline
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}
		if p.PayloadTemplate == "" {
			p.PayloadTemplate = "{}"
		}
		err := db.QueryRow(`
					UPDATE codefac_pipelines SET
						name=$1, pipeline_name=$2, metric_type=$3, condition_type=$4, threshold=$5,
						payload_template=$6, cooldown_seconds=$7, enabled=$8, updated_at=NOW()
					WHERE id=$9
			RETURNING id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
							payload_template, cooldown_seconds, enabled, last_triggered_at, created_at, updated_at`,
			p.Name, p.PipelineName, p.MetricType, p.ConditionType, p.Threshold,
			p.PayloadTemplate, p.CooldownSeconds, p.Enabled, id).
			Scan(&p.ID, &p.TenantID, &p.Name, &p.PipelineName, &p.MetricType, &p.ConditionType,
				&p.Threshold, &p.PayloadTemplate, &p.CooldownSeconds, &p.Enabled, &p.LastTriggeredAt, &p.CreatedAt, &p.UpdatedAt)
		if err == sql.ErrNoRows {
			writeJSONError(w, "codefac pipeline not found", http.StatusNotFound)
			return
		}
		if err != nil {
			log.Printf("ERROR: update codefac_pipeline: %v", err)
			writeJSONError(w, fmt.Sprintf("update: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, p, http.StatusOK)

	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}
		_, err := db.Exec(`DELETE FROM codefac_pipelines WHERE id = $1`, id)
		if err != nil {
			log.Printf("ERROR: delete codefac_pipeline: %v", err)
			writeJSONError(w, fmt.Sprintf("delete: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "deleted"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// codefacPipelineTriggerHandler handles POST /api/codefac-pipelines/trigger.
// It manually triggers a Codefac pipeline for a specific workflow failure.
func codefacPipelineTriggerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	var req struct {
		PipelineID   int    `json:"pipeline_id"`
		WorkflowID   string `json:"workflow_id"`
		RunID        string `json:"run_id"`
		WorkflowType string `json:"workflow_type"`
		Tasklist     string `json:"tasklist"`
		Status       string `json:"status"`
		CloseTime    string `json:"close_time"`
		Domain       string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	if req.PipelineID <= 0 {
		writeJSONError(w, "pipeline_id is required", http.StatusBadRequest)
		return
	}

	// Load the pipeline
	var pipe CodefacPipeline
	err := db.QueryRow(`
			SELECT id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
				payload_template, cooldown_seconds, enabled, last_triggered_at, created_at, updated_at
			FROM codefac_pipelines WHERE id = $1 AND tenant_id = $2`, req.PipelineID, tenantID).
		Scan(&pipe.ID, &pipe.TenantID, &pipe.Name, &pipe.PipelineName,
			&pipe.MetricType, &pipe.ConditionType, &pipe.Threshold,
			&pipe.PayloadTemplate, &pipe.CooldownSeconds, &pipe.Enabled, &pipe.LastTriggeredAt, &pipe.CreatedAt, &pipe.UpdatedAt)
	if err == sql.ErrNoRows {
		writeJSONError(w, "codefac pipeline not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("ERROR: load codefac pipeline %d: %v", req.PipelineID, err)
		writeJSONError(w, fmt.Sprintf("load pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Load the tenant to get NotifyHub config
	tenant, err := tenantStore.GetByID(tenantID)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
		return
	}
	if tenant == nil {
		writeJSONError(w, "tenant not found", http.StatusNotFound)
		return
	}
	if tenant.NotifyHubURL == "" || tenant.NotifyHubAPIKey == "" {
		writeJSONError(w, "tenant NotifyHub is not configured", http.StatusBadRequest)
		return
	}

	// Render payload template with workflow data
	wf := RecentWorkflow{
		WorkflowID:   req.WorkflowID,
		RunID:        req.RunID,
		WorkflowType: req.WorkflowType,
		TaskList:     req.Tasklist,
		Status:       req.Status,
		CloseTime:    req.CloseTime,
	}
	payloadStr := applyCodefacWorkflowPayload(pipe.PayloadTemplate, pipe, tenant, pipe.Name, wf)

	// Send via NotifyHub
	notifyPayload := map[string]interface{}{
		"idempotency_key": newUUIDv4(),
		"type":            "alert",
		"channels":        []string{"webhook"},
		"forced_vendor":   "codefac",
		"subject":         fmt.Sprintf("[MANUAL TRIGGER] %s - %s", pipe.Name, req.WorkflowType),
		"body":            payloadStr,
		"recipient":       pipe.PipelineName,
	}
	notifyPayload["template_variables"] = map[string]string{
		"pipeline_name": pipe.Name,
		"rule_name":     pipe.Name,
		"workflow_id":   req.WorkflowID,
		"run_id":        req.RunID,
		"workflow_type": req.WorkflowType,
		"status":        req.Status,
		"domain":        req.Domain,
	}

	payloadBytes, _ := json.Marshal(notifyPayload)
	parsedBase, _ := url.Parse(tenant.NotifyHubURL)
	stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
	notifyURL := stripped.JoinPath("/v1/notifications").String()
	httpReq, _ := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-API-Key", tenant.NotifyHubAPIKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	triggerStatus := "sent"
	errMsg := ""
	if err != nil {
		triggerStatus = "failed"
		errMsg = err.Error()
	} else {
		if resp.StatusCode >= 400 {
			triggerStatus = "failed"
			respBody, _ := io.ReadAll(resp.Body)
			errMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
		}
		resp.Body.Close()
	}

	// Record in alert_history
	now := time.Now()
	db.Exec(`
			INSERT INTO alert_history (tenant_id, tile_id, metric_type,
				metric_value, threshold, condition_type, channel, recipient, status, error_message, sent_at, workflow_id, run_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		tenantID, "recent-failures", "workflow_failure", 1.0, pipe.Threshold,
		pipe.ConditionType, "pipeline", pipe.PipelineName, triggerStatus, errMsg, now, req.WorkflowID, req.RunID)

	// Update last_triggered_at
	db.Exec(`UPDATE codefac_pipelines SET last_triggered_at = $1 WHERE id = $2`, now, pipe.ID)

	log.Printf("MANUAL CODEFAC TRIGGER: tenant %d pipeline %q workflow %s/%s -> %s (err: %s)",
		tenantID, pipe.Name, req.WorkflowID, req.RunID, triggerStatus, errMsg)

	if triggerStatus == "failed" {
		writeJSONError(w, fmt.Sprintf("trigger failed: %s", errMsg), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]interface{}{
		"status":      "triggered",
		"pipeline":    pipe.Name,
		"workflow_id": req.WorkflowID,
	}, http.StatusOK)
}

// alertsRulesTestHandler handles POST on /api/alerts/rules/test.
func alertsRulesTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id query parameter", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	var req struct {
		RuleID      int    `json:"rule_id"`
		TestMessage string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Load the tenant to get NotifyHub config
	tenant, err := tenantStore.GetByID(tenantID)
	if err != nil {
		log.Printf("ERROR: get tenant %d: %v", tenantID, err)
		writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
		return
	}
	if tenant == nil {
		writeJSONError(w, "tenant not found", http.StatusNotFound)
		return
	}
	if tenant.NotifyHubURL == "" {
		writeJSONError(w, "tenant notifyhub_url is not configured", http.StatusBadRequest)
		return
	}

	// Load the alert rule (include message_template and ses_region)
	var rule AlertRule
	err = db.QueryRow(`
		SELECT id, tenant_id, name, enabled, metric_type, condition_type, threshold,
			window_seconds, notification_channel, notification_target, notifyhub_template_id, message_template,
			ses_region, tile_id, alert_type, last_triggered_at, created_at, updated_at
		FROM alert_rules WHERE id = $1 AND tenant_id = $2`, req.RuleID, tenantID).
		Scan(&rule.ID, &rule.TenantID, &rule.Name, &rule.Enabled,
			&rule.MetricType, &rule.ConditionType, &rule.Threshold,
			&rule.WindowSeconds, &rule.NotificationChannel, &rule.NotificationTarget,
			&rule.NotifyHubTemplateID, &rule.MessageTemplate, &rule.SESRegion, &rule.TileID, &rule.AlertType, &rule.LastTriggeredAt, &rule.CreatedAt, &rule.UpdatedAt)
	if err == sql.ErrNoRows {
		writeJSONError(w, "alert rule not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("ERROR: get alert_rule %d: %v", req.RuleID, err)
		writeJSONError(w, fmt.Sprintf("get alert rule: %v", err), http.StatusInternalServerError)
		return
	}

	// Get current metric value from dashboard / SES caches for real data
	currentValue := ""
	metricInfo := ""
	recentFailedDetails := ""

	// Check dashboard cache
	if val, ok := dashboardCache.Load(tenantID); ok {
		entry := val.(*dashboardCacheEntry)
		entry.mu.RLock()
		if entry.Data != nil {
			d := entry.Data
			switch rule.MetricType {
			case "failure_rate":
				currentValue = fmt.Sprintf("%s", d.Rates1d.FailurePct)
				metricInfo = fmt.Sprintf("Current failure rate: %s (threshold: %s %.2f)", currentValue, rule.ConditionType, rule.Threshold)
			case "success_rate":
				currentValue = fmt.Sprintf("%s", d.Rates1d.SuccessPct)
				metricInfo = fmt.Sprintf("Current success rate: %s (threshold: %s %.2f)", currentValue, rule.ConditionType, rule.Threshold)
			case "volume":
				currentValue = fmt.Sprintf("%d", d.Rates1d.Total)
				metricInfo = fmt.Sprintf("Current volume: %s (threshold: %s %.2f)", currentValue, rule.ConditionType, rule.Threshold)
			case "latency_p100":
				maxLatency := int64(0)
				for _, w := range d.P100ByWorkflow {
					if w.P100LatencyMs > maxLatency {
						maxLatency = w.P100LatencyMs
					}
				}
				if maxLatency > 0 {
					currentValue = fmt.Sprintf("%d ms", maxLatency)
				} else {
					currentValue = "0 ms"
				}
				metricInfo = fmt.Sprintf("Current P100 latency: %s (threshold: %s %.2f)", currentValue, rule.ConditionType, rule.Threshold)
			case "workflow_failure", "forward_workflow":
				currentValue = fmt.Sprintf("%d", d.TotalFailed)
				metricInfo = fmt.Sprintf("Total failures in period: %s", currentValue)
				if len(d.RecentFailed) > 0 {
					var lines []string
					lines = append(lines, fmt.Sprintf("Recent failures (%d):", len(d.RecentFailed)))
					for i, wf := range d.RecentFailed {
						lines = append(lines, fmt.Sprintf("  %d. Workflow: %s | Run: %s | Type: %s | Status: %s",
							i+1, wf.WorkflowID, wf.RunID, wf.WorkflowType, wf.Status))
						if len(lines) > 15 {
							break
						}
					}
					recentFailedDetails = strings.Join(lines, "\n")
				}
			}
		}
		entry.mu.RUnlock()
	}

	// Check SES cache for SES-related metric types
	sesMetricInfo := ""
	if strings.HasPrefix(rule.MetricType, "ses_") {
		region := rule.SESRegion
		if region == "" {
			region = getEnv("AWS_REGION", "us-east-1")
		}
		if val, ok := sesCache.Load(region); ok {
			sentry := val.(*sesCacheEntry)
			sentry.mu.RLock()
			if sentry.Data != nil {
				sdata := sentry.Data
				switch rule.MetricType {
				case "ses_bounce_rate":
					currentValue = sdata.BounceRate
					sesMetricInfo = fmt.Sprintf("Region: %s | Bounce Rate: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				case "ses_complaint_rate":
					currentValue = sdata.ComplaintRate
					sesMetricInfo = fmt.Sprintf("Region: %s | Complaint Rate: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				case "ses_error_rate":
					currentValue = sdata.ErrorRate
					sesMetricInfo = fmt.Sprintf("Region: %s | Error Rate: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				case "ses_send_volume":
					currentValue = fmt.Sprintf("%d", sdata.Sends)
					sesMetricInfo = fmt.Sprintf("Region: %s | Send Volume: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				case "ses_bounce_count":
					currentValue = fmt.Sprintf("%d", sdata.Bounces)
					sesMetricInfo = fmt.Sprintf("Region: %s | Bounce Count: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				case "ses_complaint_count":
					currentValue = fmt.Sprintf("%d", sdata.Complaints)
					sesMetricInfo = fmt.Sprintf("Region: %s | Complaint Count: %s | Threshold: %s %.2f", region, currentValue, rule.ConditionType, rule.Threshold)
				default:
					sesMetricInfo = fmt.Sprintf("Region: %s | Sends: %d | Bounces: %d | Complaints: %d | Rejects: %d",
						region, sdata.Sends, sdata.Bounces, sdata.Complaints, sdata.Rejects)
					currentValue = fmt.Sprintf("%d", sdata.Sends)
				}
			}
			sentry.mu.RUnlock()
		}
		if sesMetricInfo == "" {
			sesMetricInfo = fmt.Sprintf("No SES data available for region: %s", region)
		}
	}

	// Build the notification payload with real data
	testMsg := req.TestMessage
	if testMsg == "" {
		// Use message_template from the rule if available
		if rule.MessageTemplate != "" {
			testMsg = rule.MessageTemplate
			testMsg = strings.ReplaceAll(testMsg, "{{rule_name}}", rule.Name)
			testMsg = strings.ReplaceAll(testMsg, "{{alert_name}}", rule.Name)
			testMsg = strings.ReplaceAll(testMsg, "{{metric_type}}", rule.MetricType)
			testMsg = strings.ReplaceAll(testMsg, "{{metric_label}}", rule.MetricType)
			testMsg = strings.ReplaceAll(testMsg, "{{metric_value}}", currentValue)
			testMsg = strings.ReplaceAll(testMsg, "{{condition_type}}", rule.ConditionType)
			testMsg = strings.ReplaceAll(testMsg, "{{threshold}}", fmt.Sprintf("%.2f", rule.Threshold))
			testMsg = strings.ReplaceAll(testMsg, "{{tenant_id}}", fmt.Sprintf("%d", tenantID))
			// If we have recent failure data, populate workflow-level template variables with the first failure
			if val, ok := dashboardCache.Load(tenantID); ok {
				entry := val.(*dashboardCacheEntry)
				entry.mu.RLock()
				if entry.Data != nil && len(entry.Data.RecentFailed) > 0 {
					wf := entry.Data.RecentFailed[0]
					testMsg = strings.ReplaceAll(testMsg, "{{workflow_id}}", wf.WorkflowID)
					testMsg = strings.ReplaceAll(testMsg, "{{run_id}}", wf.RunID)
					testMsg = strings.ReplaceAll(testMsg, "{{workflow_type}}", wf.WorkflowType)
					testMsg = strings.ReplaceAll(testMsg, "{{workflow-type}}", wf.WorkflowType)
					testMsg = strings.ReplaceAll(testMsg, "{{tasklist}}", wf.TaskList)
					testMsg = strings.ReplaceAll(testMsg, "{{status}}", wf.Status)
					testMsg = strings.ReplaceAll(testMsg, "{{close_time}}", wf.CloseTime)
				}
				entry.mu.RUnlock()
			}

			// Add {{dashboard_info}} from cached dashboard data
			if val, ok := dashboardCache.Load(tenantID); ok {
				entry := val.(*dashboardCacheEntry)
				entry.mu.RLock()
				if entry.Data != nil {
					d := entry.Data
					var lines []string
					lines = append(lines, fmt.Sprintf("Domain: %s", d.DomainName))
					lines = append(lines, fmt.Sprintf("Period (30min): Success= %s | Failure= %s | Volume= %d", d.Rates30min.SuccessPct, d.Rates30min.FailurePct, d.Rates30min.Total))
					lines = append(lines, fmt.Sprintf("Period (1hr):   Success= %s | Failure= %s | Volume= %d", d.Rates1hr.SuccessPct, d.Rates1hr.FailurePct, d.Rates1hr.Total))
					lines = append(lines, fmt.Sprintf("Period (1d):    Success= %s | Failure= %s | Volume= %d", d.Rates1d.SuccessPct, d.Rates1d.FailurePct, d.Rates1d.Total))
					lines = append(lines, fmt.Sprintf("Period (7d):    Success= %s | Failure= %s | Volume= %d", d.Rates7d.SuccessPct, d.Rates7d.FailurePct, d.Rates7d.Total))
					lines = append(lines, fmt.Sprintf("Period (30d):   Success= %s | Failure= %s | Volume= %d", d.Rates30d.SuccessPct, d.Rates30d.FailurePct, d.Rates30d.Total))
					testMsg = strings.ReplaceAll(testMsg, "{{dashboard_info}}", strings.Join(lines, "\n"))
				}
				entry.mu.RUnlock()
			}
			testMsg = strings.ReplaceAll(testMsg, "{{dashboard_info}}", "")

			// Add SES template variables if applicable
			testMsg = strings.ReplaceAll(testMsg, "{{ses_region}}", rule.SESRegion)
			if strings.HasPrefix(rule.MetricType, "ses_") {
				region := rule.SESRegion
				if region == "" {
					region = getEnv("AWS_REGION", "us-east-1")
				}
				testMsg = strings.ReplaceAll(testMsg, "{{ses_region}}", region)
				if val, ok := sesCache.Load(region); ok {
					sentry := val.(*sesCacheEntry)
					sentry.mu.RLock()
					sdata := sentry.Data
					sentry.mu.RUnlock()
					if sdata != nil {
						testMsg = strings.ReplaceAll(testMsg, "{{total_sends}}", fmt.Sprintf("%d", sdata.Sends))
						testMsg = strings.ReplaceAll(testMsg, "{{bounces}}", fmt.Sprintf("%d", sdata.Bounces))
						testMsg = strings.ReplaceAll(testMsg, "{{complaints}}", fmt.Sprintf("%d", sdata.Complaints))
						testMsg = strings.ReplaceAll(testMsg, "{{rejects}}", fmt.Sprintf("%d", sdata.Rejects))
						testMsg = strings.ReplaceAll(testMsg, "{{bounce_rate}}", sdata.BounceRate)
						testMsg = strings.ReplaceAll(testMsg, "{{complaint_rate}}", sdata.ComplaintRate)
						testMsg = strings.ReplaceAll(testMsg, "{{error_rate}}", sdata.ErrorRate)
						testMsg = strings.ReplaceAll(testMsg, "{{permanent_bounces}}", fmt.Sprintf("%d", sdata.PermanentBounces))
						testMsg = strings.ReplaceAll(testMsg, "{{transient_bounces}}", fmt.Sprintf("%d", sdata.TransientBounces))
					}
				}
			}
		} else if sesMetricInfo != "" {
			testMsg = fmt.Sprintf("Alert: %s\nMetric: %s\n%s\nWindow: %ds\nStatus: TRIGGERED",
				rule.Name, rule.MetricType, sesMetricInfo, rule.WindowSeconds)
		} else if metricInfo != "" {
			testMsg = fmt.Sprintf("Alert: %s\nMetric: %s\n%s\nWindow: %ds\nStatus: TRIGGERED",
				rule.Name, rule.MetricType, metricInfo, rule.WindowSeconds)
			if recentFailedDetails != "" {
				testMsg += "\n\n" + recentFailedDetails
			}
		} else {
			testMsg = fmt.Sprintf("Alert: %s\nMetric: %s\nCurrent value: %s\nThreshold: %s %.2f\nWindow: %ds\nStatus: TRIGGERED (test)",
				rule.Name, rule.MetricType, currentValue, rule.ConditionType, rule.Threshold, rule.WindowSeconds)
		}
	}

	notifyPayload := map[string]interface{}{
		"idempotency_key": newUUIDv4(),
		"type":            "test",
		"channels":        []string{rule.NotificationChannel},
		"subject":         fmt.Sprintf("[TEST] Alert Rule: %s", rule.Name),
		"body":            testMsg,
		"recipient":       rule.NotificationTarget,
	}
	if rule.NotifyHubTemplateID != "" {
		notifyPayload["template_id"] = rule.NotifyHubTemplateID
	}
	if rule.NotificationChannel == "slack" && rule.NotificationTarget != "" {
		notifyPayload["slack_channel"] = rule.NotificationTarget
	}
	notifyPayload["template_variables"] = map[string]string{
		"rule_name":      rule.Name,
		"metric_type":    rule.MetricType,
		"condition_type": rule.ConditionType,
		"threshold":      fmt.Sprintf("%.2f", rule.Threshold),
		"window_seconds": fmt.Sprintf("%d", rule.WindowSeconds),
		"test":           "true",
	}

	body, err := json.Marshal(notifyPayload)
	if err != nil {
		log.Printf("ERROR: marshal notify payload: %v", err)
		writeJSONError(w, fmt.Sprintf("marshal payload: %v", err), http.StatusInternalServerError)
		return
	}

	// Use only the scheme+host from NotifyHubURL (strip any existing path)
	// to avoid duplicate path segments when appending /v1/...
	parsedBase, err := url.Parse(tenant.NotifyHubURL)
	if err != nil {
		log.Printf("ERROR: parse notifyhub URL %q: %v", tenant.NotifyHubURL, err)
		writeJSONError(w, fmt.Sprintf("invalid notifyhub_url: %v", err), http.StatusInternalServerError)
		return
	}
	stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
	notifyURL := stripped.JoinPath("/v1/notifications").String()
	reqHTTP, err := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("ERROR: create notify request: %v", err)
		writeJSONError(w, fmt.Sprintf("create request: %v", err), http.StatusInternalServerError)
		return
	}
	reqHTTP.Header.Set("Content-Type", "application/json")
	reqHTTP.Header.Set("X-API-Key", tenant.NotifyHubAPIKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(reqHTTP)
	if err != nil {
		log.Printf("ERROR: notify request failed: %v", err)
		writeJSONError(w, fmt.Sprintf("notify request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("ERROR: read notify response: %v", err)
		writeJSONError(w, fmt.Sprintf("read response: %v", err), http.StatusInternalServerError)
		return
	}

	if resp.StatusCode >= 400 {
		log.Printf("ERROR: notify returned status %d: %s", resp.StatusCode, string(respBody))
		writeJSONError(w, fmt.Sprintf("notify returned status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	writeJSON(w, map[string]interface{}{
		"status":   "sent",
		"response": string(respBody),
	}, http.StatusOK)
}

// notificationChannelsHandler handles GET and PUT on /api/notification-channels.
// GET  /api/notification-channels?tenant_id=N — returns all channel configs for tenant
// PUT  /api/notification-channels?tenant_id=N — upserts channel configs (body is array of {channel, recipients[]})
func notificationChannelsHandler(w http.ResponseWriter, r *http.Request) {
	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id query parameter", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		scopeFilter := r.URL.Query().Get("scope")
		var rows *sql.Rows
		var err error
		if scopeFilter != "" {
			rows, err = db.Query(
				`SELECT id, tenant_id, channel, scope, recipients, created_at, updated_at
                 FROM notification_channels WHERE tenant_id = $1 AND scope = $2 ORDER BY channel, scope`, tenantID, scopeFilter)
		} else {
			rows, err = db.Query(
				`SELECT id, tenant_id, channel, scope, recipients, created_at, updated_at
                 FROM notification_channels WHERE tenant_id = $1 ORDER BY channel, scope`, tenantID)
		}
		if err != nil {
			log.Printf("ERROR: list notification_channels: %v", err)
			writeJSONError(w, fmt.Sprintf("list channels: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		channels := make([]NotificationChannel, 0)
		for rows.Next() {
			var c NotificationChannel
			if err := rows.Scan(&c.ID, &c.TenantID, &c.Channel, &c.Scope, pq.Array(&c.Recipients), &c.CreatedAt, &c.UpdatedAt); err != nil {
				log.Printf("ERROR: scan notification_channel: %v", err)
				writeJSONError(w, fmt.Sprintf("scan channel: %v", err), http.StatusInternalServerError)
				return
			}
			channels = append(channels, c)
		}
		if err := rows.Err(); err != nil {
			writeJSONError(w, fmt.Sprintf("read channels: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, channels, http.StatusOK)

	case http.MethodPut:
		var req []struct {
			Channel    string   `json:"channel"`
			Scope      string   `json:"scope"`
			Recipients []string `json:"recipients"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		for _, ch := range req {
			if ch.Channel == "" {
				continue
			}
			if ch.Scope == "" {
				ch.Scope = "alert"
			}
			if ch.Recipients == nil {
				ch.Recipients = []string{}
			}
			_, err := db.Exec(`
					INSERT INTO notification_channels (tenant_id, channel, scope, recipients, updated_at)
					VALUES ($1, $2, $3, $4, NOW())
					ON CONFLICT (tenant_id, channel, scope)
					DO UPDATE SET recipients = $4, updated_at = NOW()`,
				tenantID, ch.Channel, ch.Scope, pq.Array(ch.Recipients))
			if err != nil {
				log.Printf("ERROR: upsert notification_channel %s: %v", ch.Channel, err)
				writeJSONError(w, fmt.Sprintf("save channel %s: %v", ch.Channel, err), http.StatusInternalServerError)
				return
			}
		}

		writeJSON(w, map[string]string{"status": "saved"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// reportsHandler handles CRUD on /api/reports.
// GET    /api/reports?tenant_id=N — list reports
// POST   /api/reports?tenant_id=N — create a report
// PUT    /api/reports?id=N        — update a report
// DELETE /api/reports?id=N        — delete a report
func reportsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
				SELECT id, tenant_id, name, enabled, report_type, frequency, day_of_week, day_of_month,
					channel, recipients, send_time, timezone, message_template, client_name, workflow_top_n, regions, last_sent_at, created_at, updated_at
				FROM reports WHERE tenant_id = $1 ORDER BY id ASC`, tenantID)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("list reports: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		reports := make([]Report, 0)
		for rows.Next() {
			var r Report
			if err := rows.Scan(&r.ID, &r.TenantID, &r.Name, &r.Enabled,
				&r.ReportType, &r.Frequency, &r.DayOfWeek, &r.DayOfMonth,
				&r.Channel, pq.Array(&r.Recipients), &r.SendTime, &r.Timezone, &r.MessageTemplate, &r.ClientName, &r.WorkflowTopN, pq.Array(&r.Regions), &r.LastSentAt, &r.CreatedAt, &r.UpdatedAt); err != nil {
				writeJSONError(w, fmt.Sprintf("scan report: %v", err), http.StatusInternalServerError)
				return
			}
			reports = append(reports, r)
		}
		writeJSON(w, reports, http.StatusOK)

	case http.MethodPost:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		if tenantIDStr == "" {
			writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
			return
		}
		var tenantID int
		if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
			writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
			return
		}

		var req Report
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			writeJSONError(w, "name is required", http.StatusBadRequest)
			return
		}
		if req.Frequency == "" {
			req.Frequency = "daily"
		}
		if req.ReportType == "" {
			req.ReportType = "slo_summary"
		}
		if req.Channel == "" {
			req.Channel = "email"
		}
		if req.Recipients == nil {
			req.Recipients = []string{}
		}
		if req.SendTime == "" {
			req.SendTime = "08:00"
		}
		if req.Timezone == "" {
			req.Timezone = "UTC"
		}

		var report Report
		err := db.QueryRow(`
				INSERT INTO reports (tenant_id, name, enabled, report_type, frequency, day_of_week, day_of_month, channel, recipients, send_time, timezone, message_template, client_name, workflow_top_n, regions)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
				RETURNING id, tenant_id, name, enabled, report_type, frequency, day_of_week, day_of_month,
					channel, recipients, send_time, timezone, message_template, client_name, workflow_top_n, regions, last_sent_at, created_at, updated_at`,
			tenantID, req.Name, req.Enabled, req.ReportType, req.Frequency,
			req.DayOfWeek, req.DayOfMonth, req.Channel, pq.Array(req.Recipients),
			req.SendTime, req.Timezone, req.MessageTemplate, req.ClientName, req.WorkflowTopN, pq.Array(req.Regions)).
			Scan(&report.ID, &report.TenantID, &report.Name, &report.Enabled,
				&report.ReportType, &report.Frequency, &report.DayOfWeek, &report.DayOfMonth,
				&report.Channel, pq.Array(&report.Recipients), &report.SendTime, &report.Timezone,
				&report.MessageTemplate, &report.ClientName, &report.WorkflowTopN, pq.Array(&report.Regions), &report.LastSentAt, &report.CreatedAt, &report.UpdatedAt)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("create report: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, report, http.StatusCreated)

	case http.MethodPut:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		var req Report
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
			return
		}

		_, err := db.Exec(`
			UPDATE reports SET name=$1, enabled=$2, report_type=$3, frequency=$4,
				day_of_week=$5, day_of_month=$6, channel=$7, recipients=$8,
				send_time=$9, timezone=$10, message_template=$11, regions=$12, client_name=$13, workflow_top_n=$14, updated_at=NOW()
			WHERE id=$15`,
			req.Name, req.Enabled, req.ReportType, req.Frequency,
			req.DayOfWeek, req.DayOfMonth, req.Channel, pq.Array(req.Recipients),
			req.SendTime, req.Timezone, req.MessageTemplate, pq.Array(req.Regions), req.ClientName, req.WorkflowTopN, id)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("update report: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "updated"}, http.StatusOK)

	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			writeJSONError(w, "missing id", http.StatusBadRequest)
			return
		}
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
			writeJSONError(w, "invalid id", http.StatusBadRequest)
			return
		}

		res, err := db.Exec(`DELETE FROM reports WHERE id = $1`, id)
		if err != nil {
			writeJSONError(w, fmt.Sprintf("delete report: %v", err), http.StatusInternalServerError)
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSONError(w, "report not found", http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]string{"status": "deleted"}, http.StatusOK)

	default:
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// extractP100TopN sorts P100 entries by latency descending and returns the top N.
func extractP100TopN(entries []P100ByWorkflowEntry, topN int) []P100ByWorkflowEntry {
	if len(entries) == 0 {
		return nil
	}
	sorted := make([]P100ByWorkflowEntry, len(entries))
	copy(sorted, entries)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].P100LatencyMs > sorted[j].P100LatencyMs
	})
	if len(sorted) > topN {
		sorted = sorted[:topN]
	}
	return sorted
}

// formatP100Report builds a formatted string of top P100 entries for report output.
func formatP100Report(sorted []P100ByWorkflowEntry, topN int) string {
	if len(sorted) == 0 {
		return ""
	}
	var lines []string
	lines = append(lines, fmt.Sprintf("*Top %d Workflows by P100 Latency:*", topN))
	lines = append(lines, "```")
	lines = append(lines, fmt.Sprintf("%-3s %-40s %-10s %s", "#", "Workflow Type", "Count", "P100 Latency"))
	for i, entry := range sorted {
		latency := "-"
		if entry.P100LatencyMs > 0 {
			if entry.P100LatencyMs < 1000 {
				latency = fmt.Sprintf("%d ms", entry.P100LatencyMs)
			} else if entry.P100LatencyMs < 60000 {
				latency = fmt.Sprintf("%.1f s", float64(entry.P100LatencyMs)/1000)
			} else {
				latency = fmt.Sprintf("%dm %ds", entry.P100LatencyMs/60000, (entry.P100LatencyMs%60000)/1000)
			}
		}
		lines = append(lines, fmt.Sprintf("%-3d %-40s %-10d %s", i+1, entry.WorkflowType, entry.Count, latency))
	}
	lines = append(lines, "```")
	return strings.Join(lines, "\n")
}

// reportTriggerHandler handles POST /api/reports/trigger.
// It immediately generates and sends a report via NotifyHub.
func reportTriggerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeJSONError(w, "missing id", http.StatusBadRequest)
		return
	}
	var id int
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
		writeJSONError(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Load the report
	var report Report
	err := db.QueryRow(`
		SELECT id, tenant_id, name, enabled, report_type, frequency, day_of_week, day_of_month,
			channel, recipients, send_time, timezone, message_template, client_name, workflow_top_n, regions, last_sent_at, created_at, updated_at
		FROM reports WHERE id = $1`, id).
		Scan(&report.ID, &report.TenantID, &report.Name, &report.Enabled,
			&report.ReportType, &report.Frequency, &report.DayOfWeek, &report.DayOfMonth,
			&report.Channel, pq.Array(&report.Recipients), &report.SendTime, &report.Timezone,
			&report.MessageTemplate, &report.ClientName, &report.WorkflowTopN, pq.Array(&report.Regions), &report.LastSentAt, &report.CreatedAt, &report.UpdatedAt)
	if err == sql.ErrNoRows {
		writeJSONError(w, "report not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("ERROR: load report %d: %v", id, err)
		writeJSONError(w, fmt.Sprintf("load report: %v", err), http.StatusInternalServerError)
		return
	}

	// Load the tenant to get NotifyHub config
	tenant, err := tenantStore.GetByID(report.TenantID)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
		return
	}
	if tenant == nil {
		writeJSONError(w, "tenant not found", http.StatusNotFound)
		return
	}
	if tenant.NotifyHubURL == "" || tenant.NotifyHubAPIKey == "" {
		writeJSONError(w, "tenant NotifyHub is not configured", http.StatusBadRequest)
		return
	}

	// Helper to build dashboard info and SLO metrics from an APIResponse
	buildReportMetrics := func(d *APIResponse) (string, string, string, string, string, string, string) {
		var lines []string
		lines = append(lines, fmt.Sprintf("Domain: %s", d.DomainName))
		lines = append(lines, fmt.Sprintf("Period (30min): Success= %s | Failure= %s | Volume= %d", d.Rates30min.SuccessPct, d.Rates30min.FailurePct, d.Rates30min.Total))
		lines = append(lines, fmt.Sprintf("Period (1hr):   Success= %s | Failure= %s | Volume= %d", d.Rates1hr.SuccessPct, d.Rates1hr.FailurePct, d.Rates1hr.Total))
		lines = append(lines, fmt.Sprintf("Period (1d):    Success= %s | Failure= %s | Volume= %d", d.Rates1d.SuccessPct, d.Rates1d.FailurePct, d.Rates1d.Total))
		lines = append(lines, fmt.Sprintf("Period (7d):    Success= %s | Failure= %s | Volume= %d", d.Rates7d.SuccessPct, d.Rates7d.FailurePct, d.Rates7d.Total))
		lines = append(lines, fmt.Sprintf("Period (30d):   Success= %s | Failure= %s | Volume= %d", d.Rates30d.SuccessPct, d.Rates30d.FailurePct, d.Rates30d.Total))
		if d.TotalFailed > 0 {
			lines = append(lines, fmt.Sprintf("Recent Failures: %d", d.TotalFailed))
		}
		if len(d.TasklistLatency) > 0 {
			lines = append(lines, fmt.Sprintf("Tasklists Tracked: %d", len(d.TasklistLatency)))
		}
		dashInfo := strings.Join(lines, "\n")
		s24h := fmt.Sprintf("%d", d.Rates1d.Success)
		f24h := fmt.Sprintf("%d", d.Rates1d.Failure)
		tv24h := fmt.Sprintf("%d", d.Rates1d.Total)
		sr24h := d.Rates1d.SuccessPct
		fr24h := d.Rates1d.FailurePct
		p100Str := "-"
		if len(d.Windows) > 6 {
			p100Ms := d.Windows[6].P100LatencyMs
			if p100Ms > 0 {
				if p100Ms < 1000 {
					p100Str = fmt.Sprintf("%d ms", p100Ms)
				} else if p100Ms < 60000 {
					p100Str = fmt.Sprintf("%.1f s", float64(p100Ms)/1000)
				} else {
					p100Str = fmt.Sprintf("%dm %ds", p100Ms/60000, (p100Ms%60000)/1000)
				}
			}
		}
		return dashInfo, s24h, f24h, tv24h, p100Str, sr24h, fr24h
	}

	// Try to get cached dashboard data
	dashboardInfo := ""
	successful24h := "0"
	failures24h := "0"
	totalVolume24h := "0"
	p100Latency24h := "-"
	successRate24h := "N/A"
	failureRate24h := "N/A"
	cachedReportData := false

	if val, ok := dashboardCache.Load(report.TenantID); ok {
		entry := val.(*dashboardCacheEntry)
		entry.mu.RLock()
		if entry.Data != nil {
			cachedReportData = true
			dashboardInfo, successful24h, failures24h, totalVolume24h, p100Latency24h, successRate24h, failureRate24h = buildReportMetrics(entry.Data)
		}
		entry.mu.RUnlock()
	}

	// Fallback: if cache has no data, query ES directly to get current dashboard data
	if !cachedReportData {
		log.Printf("WARN: report %d: no cached data for tenant %d, querying ES directly", id, report.TenantID)
		cfg := tenantESConfig(tenant)
		if msResp, err := queryElasticsearch(cfg, 20, 86400, []int{1, 5}, []string{}, 0, 0, 0, "", nil, ""); err == nil {
			if apiResp, _ := buildResponse(cfg, report.TenantID, msResp, 20, []int{1, 5}, "", "", 86400); apiResp.DomainName != "" {
				dashboardInfo, successful24h, failures24h, totalVolume24h, p100Latency24h, successRate24h, failureRate24h = buildReportMetrics(&apiResp)
			}
		} else {
			log.Printf("ERROR: report %d: ES fallback query failed: %v", id, err)
		}
	}

	// Build report body
	now := time.Now().Format("2006-01-02 15:04:05")
	subject := fmt.Sprintf("[REPORT] %s - %s", report.Name, report.ReportType)

	// Gather SES metrics (populated for all report types — template can choose to use {{ses_info}} or not)
	sesInfo := ""
	{
		regions := report.Regions
		if len(regions) == 0 {
			regions = getSESRegions()
		}
		var totalSends, totalBounces, totalComplaints, totalRejects int64
		activeRegions := []string{}
		for _, r := range regions {
			if val, ok := sesCache.Load(r); ok {
				entry := val.(*sesCacheEntry)
				entry.mu.RLock()
				if entry.Data != nil {
					totalSends += entry.Data.Sends
					totalBounces += entry.Data.Bounces
					totalComplaints += entry.Data.Complaints
					totalRejects += entry.Data.Rejects
					activeRegions = append(activeRegions, r)
				}
				entry.mu.RUnlock()
			}
		}
		if len(activeRegions) > 0 && totalSends > 0 {
			bounceRate := float64(totalBounces) / float64(totalSends) * 100
			complaintRate := float64(totalComplaints) / float64(totalSends) * 100
			errorRate := float64(totalBounces+totalComplaints+totalRejects) / float64(totalSends) * 100
			sesInfo = fmt.Sprintf("SES Regions: %s\nTotal Sends: %d\nBounces: %d (%.2f%%)\nComplaints: %d (%.2f%%)\nRejects: %d\nError Rate: %.2f%%",
				strings.Join(activeRegions, ", "), totalSends, totalBounces, bounceRate,
				totalComplaints, complaintRate, totalRejects, errorRate)
		}
	}

	// Gather P100 latency data (populated for all report types — template can choose to use {{p100_info}} or not)
	p100Info := ""
	{
		topN := report.WorkflowTopN
		if topN <= 0 {
			topN = 10
		}
		p100DataAvailable := false
		if val, ok := dashboardCache.Load(report.TenantID); ok {
			entry := val.(*dashboardCacheEntry)
			entry.mu.RLock()
			if entry.Data != nil && len(entry.Data.P100ByWorkflow) > 0 {
				p100DataAvailable = true
				sorted := extractP100TopN(entry.Data.P100ByWorkflow, topN)
				p100Info = formatP100Report(sorted, topN)
			}
			entry.mu.RUnlock()
		}
		// Fallback: query ES directly if cache has no P100 data
		if !p100DataAvailable {
			log.Printf("WARN: report %d: no cached P100 data for tenant %d, querying ES directly", id, report.TenantID)
			cfg := tenantESConfig(tenant)
			if msResp, err := queryElasticsearch(cfg, 20, 86400, []int{1, 5}, []string{}, 0, 0, 0, "", nil, ""); err == nil {
				if apiResp, _ := buildResponse(cfg, report.TenantID, msResp, 20, []int{1, 5}, "", "", 86400); apiResp.DomainName != "" && len(apiResp.P100ByWorkflow) > 0 {
					sorted := extractP100TopN(apiResp.P100ByWorkflow, topN)
					p100Info = formatP100Report(sorted, topN)
				}
			} else {
				log.Printf("ERROR: report %d: P100 ES fallback query failed: %v", id, err)
			}
		}
		if p100Info == "" {
			p100Info = fmt.Sprintf("No P100 latency data available for top %d workflows.", topN)
		}
	}

	// Use custom message template if available
	body := ""
	if report.MessageTemplate != "" {
		body = report.MessageTemplate
		body = strings.ReplaceAll(body, "{{report_name}}", report.Name)
		body = strings.ReplaceAll(body, "{{report_type}}", report.ReportType)
		body = strings.ReplaceAll(body, "{{frequency}}", report.Frequency)
		body = strings.ReplaceAll(body, "{{channel}}", report.Channel)
		body = strings.ReplaceAll(body, "{{recipients}}", strings.Join(report.Recipients, ", "))
		body = strings.ReplaceAll(body, "{{timestamp}}", now)
		body = strings.ReplaceAll(body, "{{dashboard_info}}", dashboardInfo)
		body = strings.ReplaceAll(body, "{{ses_info}}", sesInfo)
		body = strings.ReplaceAll(body, "{{p100_info}}", p100Info)
		body = strings.ReplaceAll(body, "{{workflow_top_n}}", fmt.Sprintf("%d", report.WorkflowTopN))
		body = strings.ReplaceAll(body, "{{client_name}}", report.ClientName)
		// Individual SLO metric substitutions
		body = strings.ReplaceAll(body, "{{successful_24h}}", successful24h)
		body = strings.ReplaceAll(body, "{{failures_24h}}", failures24h)
		body = strings.ReplaceAll(body, "{{total_volume_24h}}", totalVolume24h)
		body = strings.ReplaceAll(body, "{{p100_latency_24h}}", p100Latency24h)
		body = strings.ReplaceAll(body, "{{success_rate_24h}}", successRate24h)
		body = strings.ReplaceAll(body, "{{failure_rate_24h}}", failureRate24h)
	} else {
		if report.ReportType == "ses_delivery_report" && sesInfo != "" {
			body = fmt.Sprintf("Report: %s\nType: %s\nGenerated: %s\n\n%s\n\n%s",
				report.Name, report.ReportType, now, dashboardInfo, sesInfo)
		} else if report.ReportType == "p100_latency_report" && p100Info != "" {
			body = fmt.Sprintf("Report: %s\nType: %s\nGenerated: %s\n\n%s\n\nSent via %s to: %s",
				report.Name, report.ReportType, now, p100Info, report.Channel, strings.Join(report.Recipients, ", "))
		} else {
			body = fmt.Sprintf("Report: %s\nType: %s\nGenerated: %s\n\n%s\n\nSent via %s to: %s",
				report.Name, report.ReportType, now, dashboardInfo, report.Channel, strings.Join(report.Recipients, ", "))
		}
	}

	// Send to each recipient via NotifyHub
	status := "sent"
	errMsg := ""
	for _, recipient := range report.Recipients {
		notifyPayload := map[string]interface{}{
			"idempotency_key": newUUIDv4(),
			"type":            "report",
			"channels":        []string{report.Channel},
			"subject":         subject,
			"body":            body,
			"recipient":       recipient,
		}
		notifyPayload["template_variables"] = map[string]string{
			"report_name": report.Name,
			"report_type": report.ReportType,
			"timestamp":   now,
		}

		payloadBytes, _ := json.Marshal(notifyPayload)
		parsedBase, _ := url.Parse(tenant.NotifyHubURL)
		stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
		notifyURL := stripped.JoinPath("/v1/notifications").String()
		httpReq, _ := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-API-Key", tenant.NotifyHubAPIKey)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			status = "failed"
			errMsg = err.Error()
			continue
		}
		if resp.StatusCode >= 400 {
			respBody, _ := io.ReadAll(resp.Body)
			status = "failed"
			errMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
		}
		resp.Body.Close()

		// Record in alert_history for this recipient
		_, err2 := db.Exec(`
			INSERT INTO alert_history (tenant_id, tile_id, metric_type, metric_value,
				threshold, condition_type, channel, recipient, status, error_message, sent_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			report.TenantID, fmt.Sprintf("report-%d", report.ID), report.ReportType, float64(len(report.Recipients)),
			0, "", "report", recipient, status, errMsg, time.Now())
		if err2 != nil {
			log.Printf("ERROR: insert alert_history for report %d / %s: %v", report.ID, recipient, err2)
		}
	}

	// Update last_sent_at if at least one succeeded
	if status == "sent" {
		db.Exec(`UPDATE reports SET last_sent_at = NOW() WHERE id = $1`, id)
	}

	if status == "failed" {
		log.Printf("ERROR: report trigger %d failed: %s", id, errMsg)
		writeJSONError(w, fmt.Sprintf("report trigger failed: %s", errMsg), http.StatusBadGateway)
		return
	}

	log.Printf("REPORT TRIGGERED: report %d %q -> sent to %d recipients", id, report.Name, len(report.Recipients))
	writeJSON(w, map[string]interface{}{
		"status":      "sent",
		"report_id":   id,
		"report_name": report.Name,
		"recipients":  len(report.Recipients),
	}, http.StatusOK)
}

// alertHistoryHandler handles GET on /api/alerts/history.
// GET /api/alerts/history?tenant_id=N&limit=50&offset=0 — list alert history
func alertHistoryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	offset := 0
	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	rows, err := db.Query(`
		SELECT id, tenant_id, alert_rule_id, tile_id, metric_type, metric_value, threshold,
			condition_type, channel, recipient, status, error_message, sent_at, created_at, workflow_id, run_id
		FROM alert_history WHERE tenant_id = $1
		ORDER BY sent_at DESC LIMIT $2 OFFSET $3`, tenantID, limit, offset)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("list alert history: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	history := make([]AlertHistory, 0)
	for rows.Next() {
		var h AlertHistory
		if err := rows.Scan(&h.ID, &h.TenantID, &h.AlertRuleID, &h.TileID,
			&h.MetricType, &h.MetricValue, &h.Threshold, &h.ConditionType,
			&h.Channel, &h.Recipient, &h.Status, &h.ErrorMessage, &h.SentAt, &h.CreatedAt, &h.WorkflowID, &h.RunID); err != nil {
			writeJSONError(w, fmt.Sprintf("scan alert history: %v", err), http.StatusInternalServerError)
			return
		}
		history = append(history, h)
	}

	// Also get total count
	var total int
	db.QueryRow(`SELECT COUNT(*) FROM alert_history WHERE tenant_id = $1`, tenantID).Scan(&total)

	writeJSON(w, map[string]interface{}{
		"history": history,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	}, http.StatusOK)
}

// ============================================================
// Main
// ============================================================

const (
	workflowFailureHistoryFetchTimout = 25 * time.Second
	workflowFailureQueueSize          = 1024
	workflowFailureWorkerCount        = 4
)

func startWorkflowFailureWorkers(ctx context.Context, workerCount int) {
	if workerCount <= 0 {
		workerCount = 1
	}
	log.Printf("Starting workflow failure enrichment workers (%d)", workerCount)
	for i := 0; i < workerCount; i++ {
		go workflowFailureWorker(ctx, i+1)
	}
}

func workflowFailureWorker(ctx context.Context, workerID int) {
	for {
		select {
		case <-ctx.Done():
			log.Printf("Workflow failure worker %d stopped", workerID)
			return
		case job := <-workflowFailureQueue:
			processWorkflowFailureJob(ctx, workerID, job)
		}
	}
}

func processWorkflowFailureJob(ctx context.Context, workerID int, job workflowFailureEnrichmentJob) {
	defer workflowFailureFetches.Delete(job.FetchKey)

	jobCtx, cancel := context.WithTimeout(ctx, workflowFailureHistoryFetchTimout+10*time.Second)
	defer cancel()

	if err := syncWorkflowFailureHit(jobCtx, &job.Tenant, job.Hit); err != nil {
		src := job.Hit.Source
		log.Printf(
			"WARN: workflow failure worker %d tenant=%d workflow=%s run=%s: %v",
			workerID, job.Tenant.ID, src.WorkflowID, src.RunID, err,
		)
	}
}

// startDashboardRefresher periodically queries ES for each tenant and caches the result.
func startDashboardRefresher(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	log.Printf("Starting dashboard data refresher (every 30s)")
	refresh := func() {
		tenants, err := tenantStore.List()
		if err != nil {
			log.Printf("ERROR: dashboard refresh: list tenants: %v", err)
			return
		}
		for _, t := range tenants {
			cfg := tenantESConfig(&t)
			msResp, err := queryElasticsearch(cfg, 20, 3600, []int{1, 5},
				[]string{}, 0, 0, 0, "", nil, "")
			if err != nil {
				log.Printf("ERROR: dashboard refresh tenant %d: %v", t.ID, err)
				continue
			}
			apiResp, totalFailed := buildResponse(cfg, t.ID, msResp, 20, []int{1, 5}, "", "", 3600)
			if recentHits := recentWorkflowHitsFromMultiSearch(msResp); len(recentHits) > 0 {
				queueWorkflowFailureEnrichment(ctx, &t, recentHits)
			}
			storedErrors, err := loadStoredActivityErrors(ctx, t.ID, 3600, 0, 0, nil, []int{1, 5})
			if err != nil {
				log.Printf("WARN: dashboard refresh tenant %d stored activity errors: %v", t.ID, err)
			} else {
				apiResp.ActivityErrors = storedErrors
				apiResp.ActivityErrorsProcessedCount = sumActivityErrorCounts(storedErrors)
				if totalFailed > apiResp.ActivityErrorsProcessedCount {
					apiResp.ActivityErrorsPendingCount = totalFailed - apiResp.ActivityErrorsProcessedCount
					apiResp.ActivityErrorsPending = true
				}
			}

			entry := &dashboardCacheEntry{}
			entry.mu.Lock()
			entry.Data = &apiResp
			entry.TotalFailed = totalFailed
			entry.UpdatedAt = time.Now()
			entry.mu.Unlock()

			dashboardCache.Store(t.ID, entry)
		}
	}

	refresh()

	for {
		select {
		case <-ctx.Done():
			log.Printf("Dashboard refresher stopped")
			return
		case <-ticker.C:
			refresh()
		}
	}
}

// startSESRefresher periodically queries CloudWatch for each configured region and caches the result.
func startSESRefresher(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	log.Printf("Starting SES data refresher (every 60s)")
	for {
		select {
		case <-ctx.Done():
			log.Printf("SES refresher stopped")
			return
		case <-ticker.C:
			regions := getSESRegions()
			now := time.Now().UTC()
			startTime := now.Add(-1 * time.Hour)
			sesCfg := getSESCloudWatchConfig()

			for _, region := range regions {
				sesCfg.Region = region
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				result, err := queryCloudWatchSESMetrics(ctx, sesCfg, 60, startTime, now)
				cancel()
				if err != nil {
					log.Printf("ERROR: SES refresh region %s: %v", region, err)
					continue
				}
				result.DomainName = getEnv("SES_DOMAIN_NAME", "ses")

				entry := &sesCacheEntry{}
				entry.mu.Lock()
				entry.Data = result
				entry.UpdatedAt = time.Now()
				entry.mu.Unlock()

				sesCache.Store(region, entry)
			}
		}
	}
}

// startAlertEvaluator periodically checks alert rules against cached data and sends notifications.
func startAlertEvaluator(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	log.Printf("Starting alert evaluator (every 30s)")
	for {
		select {
		case <-ctx.Done():
			log.Printf("Alert evaluator stopped")
			return
		case <-ticker.C:
			tenants, err := tenantStore.List()
			if err != nil {
				log.Printf("ERROR: alert eval: list tenants: %v", err)
				continue
			}
			for _, t := range tenants {
				// Load alert rules for this tenant
				rows, err := db.Query(`
                    SELECT id, tenant_id, name, enabled, metric_type, condition_type, threshold,
                        window_seconds, notification_channel, notification_target, notifyhub_template_id,
                        ses_region, tile_id, alert_type, cooldown_seconds, last_triggered_at
                    FROM alert_rules WHERE tenant_id = $1 AND enabled = true`, t.ID)
				if err != nil {
					log.Printf("ERROR: alert eval: query rules tenant %d: %v", t.ID, err)
					continue
				}

				var rules []AlertRule
				for rows.Next() {
					var r AlertRule
					if err := rows.Scan(&r.ID, &r.TenantID, &r.Name, &r.Enabled,
						&r.MetricType, &r.ConditionType, &r.Threshold,
						&r.WindowSeconds, &r.NotificationChannel, &r.NotificationTarget,
						&r.NotifyHubTemplateID, &r.SESRegion, &r.TileID, &r.AlertType, &r.CooldownSeconds, &r.LastTriggeredAt); err != nil {
						log.Printf("ERROR: alert eval: scan rule: %v", err)
						continue
					}
					rules = append(rules, r)
				}
				rows.Close()

				// Dashboard cache is only required for threshold-style alert_rules.
				// Workflow failure pipeline requests should still run even if there are
				// no standard rules or no cached dashboard snapshot yet.
				var data *APIResponse
				if cacheVal, ok := dashboardCache.Load(t.ID); ok {
					entry := cacheVal.(*dashboardCacheEntry)
					entry.mu.RLock()
					data = entry.Data
					entry.mu.RUnlock()
				}

				// Evaluate threshold-style alert rules only when both rules and cached
				// dashboard data are available.
				if len(rules) > 0 && data != nil {
					for _, rule := range rules {
						var metricValue float64
						var metricLabel string
						found := false

						switch rule.MetricType {
						case "success_rate":
							if data.Rates1d.Total > 0 && data.Rates1d.SuccessPct != "N/A" {
								if v, err := strconv.ParseFloat(data.Rates1d.SuccessPct, 64); err == nil {
									metricValue = v
									metricLabel = "success_rate"
									found = true
								}
							}
						case "failure_rate":
							if data.Rates1d.Total > 0 && data.Rates1d.FailurePct != "N/A" {
								if v, err := strconv.ParseFloat(data.Rates1d.FailurePct, 64); err == nil {
									metricValue = v
									metricLabel = "failure_rate"
									found = true
								}
							}
						case "volume":
							metricValue = float64(data.Rates1d.Total)
							metricLabel = "volume"
							found = true
						case "latency_p100":
							if len(data.Windows) > 2 {
								metricValue = float64(data.Windows[2].P100LatencyMs) // 24h window
								metricLabel = "latency_p100"
								found = true
							}

						case "ses_bounce_rate", "ses_complaint_rate", "ses_error_rate":
							// Evaluate against sesCache for the specified region
							region := rule.SESRegion
							if region == "" {
								region = getEnv("AWS_REGION", "us-east-1")
							}
							cacheVal, ok := sesCache.Load(region)
							if !ok {
								continue
							}
							sentry := cacheVal.(*sesCacheEntry)
							sentry.mu.RLock()
							sdata := sentry.Data
							sentry.mu.RUnlock()
							if sdata == nil || sdata.Sends == 0 {
								continue
							}
							switch rule.MetricType {
							case "ses_bounce_rate":
								if v, err := strconv.ParseFloat(strings.ReplaceAll(sdata.BounceRate, "%", ""), 64); err == nil {
									metricValue = v
									metricLabel = "ses_bounce_rate"
									found = true
								}
							case "ses_complaint_rate":
								if v, err := strconv.ParseFloat(strings.ReplaceAll(sdata.ComplaintRate, "%", ""), 64); err == nil {
									metricValue = v
									metricLabel = "ses_complaint_rate"
									found = true
								}
							case "ses_error_rate":
								if v, err := strconv.ParseFloat(strings.ReplaceAll(sdata.ErrorRate, "%", ""), 64); err == nil {
									metricValue = v
									metricLabel = "ses_error_rate"
									found = true
								}
							}

						case "ses_send_volume":
							region := rule.SESRegion
							if region == "" {
								region = getEnv("AWS_REGION", "us-east-1")
							}
							cacheVal, ok := sesCache.Load(region)
							if !ok {
								continue
							}
							sentry := cacheVal.(*sesCacheEntry)
							sentry.mu.RLock()
							sdata := sentry.Data
							sentry.mu.RUnlock()
							if sdata == nil {
								continue
							}
							metricValue = float64(sdata.Sends)
							metricLabel = "ses_send_volume"
							found = true

						case "ses_bounce_count":
							region := rule.SESRegion
							if region == "" {
								region = getEnv("AWS_REGION", "us-east-1")
							}
							cacheVal, ok := sesCache.Load(region)
							if !ok {
								continue
							}
							sentry := cacheVal.(*sesCacheEntry)
							sentry.mu.RLock()
							sdata := sentry.Data
							sentry.mu.RUnlock()
							if sdata == nil {
								continue
							}
							metricValue = float64(sdata.Bounces)
							metricLabel = "ses_bounce_count"
							found = true

						case "ses_complaint_count":
							region := rule.SESRegion
							if region == "" {
								region = getEnv("AWS_REGION", "us-east-1")
							}
							cacheVal, ok := sesCache.Load(region)
							if !ok {
								continue
							}
							sentry := cacheVal.(*sesCacheEntry)
							sentry.mu.RLock()
							sdata := sentry.Data
							sentry.mu.RUnlock()
							if sdata == nil {
								continue
							}
							metricValue = float64(sdata.Complaints)
							metricLabel = "ses_complaint_count"
							found = true
						}

						if !found {
							continue
						}

						// Check condition
						triggered := false
						switch rule.ConditionType {
						case "greater_than":
							triggered = metricValue > rule.Threshold
						case "less_than":
							triggered = metricValue < rule.Threshold
						}

						if !triggered {
							// Condition not met — clear episode state so zero-cooldown rules can re-arm
							if rule.CooldownSeconds <= 0 {
								triggerKey := fmt.Sprintf("%d:%d", t.ID, rule.ID)
								triggeredRules.Delete(triggerKey)
							}
							continue
						}

						if alertRuleInCooldown(rule.LastTriggeredAt, rule.CooldownSeconds) {
							continue
						}

						// Zero-cooldown rules fire once per breach episode until condition clears
						if rule.CooldownSeconds <= 0 {
							triggerKey := fmt.Sprintf("%d:%d", t.ID, rule.ID)
							if _, alreadyFired := triggeredRules.LoadOrStore(triggerKey, true); alreadyFired {
								continue
							}
						}

						// Send notification via NotifyHub
						if t.NotifyHubURL == "" || t.NotifyHubAPIKey == "" {
							log.Printf("WARN: tenant %d has no NotifyHub config, cannot send alert", t.ID)
							continue
						}

						// Use custom message template if available
						bodyMsg := fmt.Sprintf("Alert %q triggered: %s is %.2f (threshold: %s %.2f)", rule.Name, metricLabel, metricValue, rule.ConditionType, rule.Threshold)
						if rule.MessageTemplate != "" {
							bodyMsg = rule.MessageTemplate
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{rule_name}}", rule.Name)
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_type}}", rule.MetricType)
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_label}}", metricLabel)
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_value}}", fmt.Sprintf("%.2f", metricValue))
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{condition_type}}", rule.ConditionType)
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{threshold}}", fmt.Sprintf("%.2f", rule.Threshold))
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{tenant_id}}", fmt.Sprintf("%d", t.ID))
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{alert_name}}", rule.Name)

							// Add {{dashboard_info}} from cached dashboard data
							if data != nil {
								var dashLines []string
								dashLines = append(dashLines, fmt.Sprintf("Domain: %s", data.DomainName))
								dashLines = append(dashLines, fmt.Sprintf("Period (30min): Success= %s | Failure= %s | Volume= %d", data.Rates30min.SuccessPct, data.Rates30min.FailurePct, data.Rates30min.Total))
								dashLines = append(dashLines, fmt.Sprintf("Period (1hr):   Success= %s | Failure= %s | Volume= %d", data.Rates1hr.SuccessPct, data.Rates1hr.FailurePct, data.Rates1hr.Total))
								dashLines = append(dashLines, fmt.Sprintf("Period (1d):    Success= %s | Failure= %s | Volume= %d", data.Rates1d.SuccessPct, data.Rates1d.FailurePct, data.Rates1d.Total))
								dashLines = append(dashLines, fmt.Sprintf("Period (7d):    Success= %s | Failure= %s | Volume= %d", data.Rates7d.SuccessPct, data.Rates7d.FailurePct, data.Rates7d.Total))
								dashLines = append(dashLines, fmt.Sprintf("Period (30d):   Success= %s | Failure= %s | Volume= %d", data.Rates30d.SuccessPct, data.Rates30d.FailurePct, data.Rates30d.Total))
								bodyMsg = strings.ReplaceAll(bodyMsg, "{{dashboard_info}}", strings.Join(dashLines, "\n"))
							} else {
								bodyMsg = strings.ReplaceAll(bodyMsg, "{{dashboard_info}}", "")
							}

							// Add SES-specific template variables for SES-related rules
							bodyMsg = strings.ReplaceAll(bodyMsg, "{{ses_region}}", rule.SESRegion)
							if strings.HasPrefix(rule.MetricType, "ses_") {
								region := rule.SESRegion
								if region == "" {
									region = getEnv("AWS_REGION", "us-east-1")
								}
								bodyMsg = strings.ReplaceAll(bodyMsg, "{{ses_region}}", region)
								if cacheVal, ok := sesCache.Load(region); ok {
									sentry := cacheVal.(*sesCacheEntry)
									sentry.mu.RLock()
									sdata := sentry.Data
									sentry.mu.RUnlock()
									if sdata != nil {
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{total_sends}}", fmt.Sprintf("%d", sdata.Sends))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{bounces}}", fmt.Sprintf("%d", sdata.Bounces))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{complaints}}", fmt.Sprintf("%d", sdata.Complaints))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{rejects}}", fmt.Sprintf("%d", sdata.Rejects))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{bounce_rate}}", sdata.BounceRate)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{complaint_rate}}", sdata.ComplaintRate)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{error_rate}}", sdata.ErrorRate)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{permanent_bounces}}", fmt.Sprintf("%d", sdata.PermanentBounces))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{transient_bounces}}", fmt.Sprintf("%d", sdata.TransientBounces))
									}
								}
							}
						}

						notifyPayload := map[string]interface{}{
							"idempotency_key": newUUIDv4(),
							"type":            "alert",
							"channels":        []string{rule.NotificationChannel},
							"subject":         fmt.Sprintf("[ALERT] %s - %s %.2f", rule.Name, rule.ConditionType, rule.Threshold),
							"body":            bodyMsg,
							"recipient":       rule.NotificationTarget,
						}
						if rule.NotifyHubTemplateID != "" {
							notifyPayload["template_id"] = rule.NotifyHubTemplateID
						}
						if rule.NotificationChannel == "slack" && rule.NotificationTarget != "" {
							notifyPayload["slack_channel"] = rule.NotificationTarget
						}
						notifyPayload["template_variables"] = map[string]string{
							"rule_name":      rule.Name,
							"rule_id":        fmt.Sprintf("%d", rule.ID),
							"tile_id":        rule.TileID,
							"metric_type":    rule.MetricType,
							"metric_value":   fmt.Sprintf("%.2f", metricValue),
							"condition_type": rule.ConditionType,
							"threshold":      fmt.Sprintf("%.2f", rule.Threshold),
						}

						payloadBytes, err := json.Marshal(notifyPayload)
						if err != nil {
							log.Printf("ERROR: alert eval: marshal payload: %v", err)
							continue
						}

						// Use only the scheme+host from NotifyHubURL (strip any existing path)
						// to avoid duplicate path segments when appending /v1/...
						parsedBase, err := url.Parse(t.NotifyHubURL)
						if err != nil {
							log.Printf("ERROR: alert eval: parse notifyhub URL %q: %v", t.NotifyHubURL, err)
							continue
						}
						stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
						notifyURL := stripped.JoinPath("/v1/notifications").String()
						httpReq, err := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
						if err != nil {
							log.Printf("ERROR: alert eval: create request: %v", err)
							continue
						}
						httpReq.Header.Set("Content-Type", "application/json")
						httpReq.Header.Set("X-API-Key", t.NotifyHubAPIKey)

						client := &http.Client{Timeout: 15 * time.Second}
						resp, err := client.Do(httpReq)
						status := "sent"
						errMsg := ""
						if err != nil {
							status = "failed"
							errMsg = err.Error()
						} else {
							if resp.StatusCode >= 400 {
								status = "failed"
								respBody, _ := io.ReadAll(resp.Body)
								errMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
							}
							resp.Body.Close()
						}

						// Record alert history
						now := time.Now()
						db.Exec(`
                        INSERT INTO alert_history (tenant_id, alert_rule_id, tile_id, metric_type,
                            metric_value, threshold, condition_type, channel, recipient, status, error_message, sent_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
							t.ID, rule.ID, rule.TileID, rule.MetricType, metricValue, rule.Threshold,
							rule.ConditionType, rule.NotificationChannel, rule.NotificationTarget,
							status, errMsg, now)

						// Update last_triggered_at
						db.Exec(`UPDATE alert_rules SET last_triggered_at = $1 WHERE id = $2`, now, rule.ID)

						// ─── Codefac Pipeline Evaluation ────────────────
						if rule.NotificationChannel == "webhook" {
							pipelineRows, err := db.Query(`
							SELECT id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
								payload_template, cooldown_seconds, enabled, last_triggered_at
							FROM codefac_pipelines WHERE tenant_id = $1 AND enabled = true
							AND metric_type = $2 AND condition_type = $3`, t.ID, rule.MetricType, rule.ConditionType)
							if err == nil {
								for pipelineRows.Next() {
									var pipe CodefacPipeline
									if err := pipelineRows.Scan(&pipe.ID, &pipe.TenantID, &pipe.Name, &pipe.PipelineName,
										&pipe.MetricType, &pipe.ConditionType, &pipe.Threshold,
										&pipe.PayloadTemplate, &pipe.CooldownSeconds, &pipe.Enabled, &pipe.LastTriggeredAt); err != nil {
										continue
									}
									// Check threshold matches
									var conditionMet bool
									switch pipe.ConditionType {
									case "greater_than":
										conditionMet = metricValue > pipe.Threshold
									case "less_than":
										conditionMet = metricValue < pipe.Threshold
									}
									if !conditionMet {
										if pipe.CooldownSeconds <= 0 {
											pipeKey := fmt.Sprintf("%d:%d:%d", t.ID, rule.ID, pipe.ID)
											triggeredRules.Delete(pipeKey)
										}
										continue
									}
									if alertRuleInCooldown(pipe.LastTriggeredAt, pipe.CooldownSeconds) {
										continue
									}
									if pipe.CooldownSeconds <= 0 {
										pipeKey := fmt.Sprintf("%d:%d:%d", t.ID, rule.ID, pipe.ID)
										if _, pipeFired := triggeredRules.LoadOrStore(pipeKey, true); pipeFired {
											continue
										}
									}

									// Build payload from template with variable substitution
									payloadStr := pipe.PayloadTemplate
									payloadStr = strings.ReplaceAll(payloadStr, "{{rule_name}}", rule.Name)
									payloadStr = strings.ReplaceAll(payloadStr, "{{metric_type}}", rule.MetricType)
									payloadStr = strings.ReplaceAll(payloadStr, "{{metric_value}}", fmt.Sprintf("%.2f", metricValue))
									payloadStr = strings.ReplaceAll(payloadStr, "{{metric_label}}", metricLabel)
									payloadStr = strings.ReplaceAll(payloadStr, "{{condition_type}}", rule.ConditionType)
									payloadStr = strings.ReplaceAll(payloadStr, "{{threshold}}", fmt.Sprintf("%.2f", pipe.Threshold))
									payloadStr = strings.ReplaceAll(payloadStr, "{{tenant_id}}", fmt.Sprintf("%d", t.ID))
									payloadStr = strings.ReplaceAll(payloadStr, "{{pipeline_name}}", pipe.Name)
									payloadStr = strings.ReplaceAll(payloadStr, "{{alert_name}}", rule.Name)
									payloadStr = strings.ReplaceAll(payloadStr, "{{idempotency_key}}", newUUIDv4())

									// Send via NotifyHub (which handles headers/delivery)
									notifyPayload := map[string]interface{}{
										"idempotency_key": newUUIDv4(),
										"type":            "alert",
										"channels":        []string{"webhook"},
										"forced_vendor":   "codefac",
										"subject":         fmt.Sprintf("[PIPELINE] %s", pipe.Name),
										"body":            payloadStr,
										"recipient":       pipe.PipelineName,
									}
									notifyPayload["template_variables"] = map[string]string{
										"pipeline_name":  pipe.Name,
										"rule_name":      rule.Name,
										"metric_type":    rule.MetricType,
										"metric_value":   fmt.Sprintf("%.2f", metricValue),
										"condition_type": rule.ConditionType,
										"threshold":      fmt.Sprintf("%.2f", pipe.Threshold),
									}

									payloadBytes, _ := json.Marshal(notifyPayload)
									parsedBase, _ := url.Parse(t.NotifyHubURL)
									stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
									notifyURL := stripped.JoinPath("/v1/notifications").String()
									httpReq, _ := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
									httpReq.Header.Set("Content-Type", "application/json")
									httpReq.Header.Set("X-API-Key", t.NotifyHubAPIKey)

									client := &http.Client{Timeout: 15 * time.Second}
									resp, err := client.Do(httpReq)
									pipeStatus := "sent"
									pipeErrMsg := ""
									if err != nil {
										pipeStatus = "failed"
										pipeErrMsg = err.Error()
									} else {
										if resp.StatusCode >= 400 {
											pipeStatus = "failed"
											respBody, _ := io.ReadAll(resp.Body)
											pipeErrMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
										}
										resp.Body.Close()
									}

									// Record in alert_history
									now := time.Now()
									db.Exec(`
									INSERT INTO alert_history (tenant_id, alert_rule_id, tile_id, metric_type,
										metric_value, threshold, condition_type, channel, recipient, status, error_message, sent_at, workflow_id, run_id)
									VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
										t.ID, &pipe.ID, rule.TileID, rule.MetricType, metricValue, pipe.Threshold,
										pipe.ConditionType, "pipeline", pipe.PipelineName, pipeStatus, pipeErrMsg, now, "", "")

									// Update last_triggered_at
									db.Exec(`UPDATE codefac_pipelines SET last_triggered_at = $1 WHERE id = $2`, now, pipe.ID)

									log.Printf("CODEFAC PIPELINE: tenant %d pipeline %q triggered (%.2f %s %.2f) -> %s",
										t.ID, pipe.Name, metricValue, pipe.ConditionType, pipe.Threshold, pipeStatus)
								}
								pipelineRows.Close()
							}
						}

						log.Printf("ALERT: tenant %d rule %q triggered (%.2f %s %.2f) -> %s", t.ID, rule.Name, metricValue, rule.ConditionType, rule.Threshold, status)
					}
				}

				// ─── Workflow Failure Evaluation ─────────────────
				// Check recent failed/timed out workflows and trigger matching pipelines.
				// Use stored workflow_failures as the source of truth so pipeline triggering
				// does not depend on the dashboard cache path being populated first.
				recentPipelineFailures, err := loadRecentStoredWorkflowFailures(ctx, t.ID, 20, time.Hour)
				if err != nil {
					log.Printf("WARN: workflow failure pipeline load tenant=%d: %v", t.ID, err)
					recentPipelineFailures = nil
				}
				if len(recentPipelineFailures) > 0 {
					pipeRows, err := db.Query(`
						SELECT id, tenant_id, name, pipeline_name, metric_type, condition_type, threshold,
							payload_template, cooldown_seconds, enabled, last_triggered_at
						FROM codefac_pipelines WHERE tenant_id = $1 AND enabled = true
						AND metric_type = 'workflow_failure'`, t.ID)
					if err == nil {
						for pipeRows.Next() {
							var pipe CodefacPipeline
							if err := pipeRows.Scan(&pipe.ID, &pipe.TenantID, &pipe.Name, &pipe.PipelineName,
								&pipe.MetricType, &pipe.ConditionType, &pipe.Threshold,
								&pipe.PayloadTemplate, &pipe.CooldownSeconds, &pipe.Enabled, &pipe.LastTriggeredAt); err != nil {
								continue
							}
							for _, wf := range recentPipelineFailures {
								errorDetails := workflowFailureErrorDetails(ctx, t.ID, wf)
								failureRow, err := upsertPipelineWorkflowFailure(ctx, t.ID, pipe, wf, errorDetails)
								if err != nil {
									log.Printf("WARN: pipeline workflow failure upsert tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									continue
								}
								if pipelineWorkflowFailureIsFinal(failureRow.Status) {
									continue
								}
								if workflowAlertAlreadySent(pipe.ID, wf.WorkflowID, wf.RunID) {
									if err := markPipelineWorkflowFailureFromHistory(ctx, failureRow); err != nil {
										log.Printf("WARN: pipeline workflow failure backfill tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									}
									continue
								}
								if alertRuleInCooldown(pipe.LastTriggeredAt, pipe.CooldownSeconds) {
									if err := markPipelineWorkflowFailureCooldown(ctx, failureRow, pipe.LastTriggeredAt); err != nil {
										log.Printf("WARN: pipeline workflow failure cooldown tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									}
									continue
								}
								blockingRow, err := findBlockingPipelineWorkflowFailure(ctx, failureRow)
								if err != nil {
									log.Printf("WARN: pipeline workflow failure lookup tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									continue
								}
								if blockingRow != nil {
									skipStatus := pipelineWorkflowFailureStatusSkippedDuplicate
									if blockingRow.Status == pipelineWorkflowFailureStatusProcessing {
										skipStatus = pipelineWorkflowFailureStatusSkippedInflight
									}
									if err := markPipelineWorkflowFailureSkipped(ctx, failureRow, skipStatus, blockingRow); err != nil {
										log.Printf("WARN: pipeline workflow failure skip tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									}
									continue
								}
								if err := markPipelineWorkflowFailureProcessing(ctx, failureRow, errorDetails); err != nil {
									log.Printf("WARN: pipeline workflow failure processing tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									continue
								}
								payloadStr := applyCodefacWorkflowPayload(pipe.PayloadTemplate, pipe, &t, pipe.Name, wf)

								notifyPayload := map[string]interface{}{
									"idempotency_key": newUUIDv4(),
									"type":            "alert",
									"channels":        []string{"webhook"},
									"forced_vendor":   "codefac",
									"subject":         fmt.Sprintf("[WORKFLOW FAILURE] %s - %s", pipe.Name, wf.WorkflowType),
									"body":            payloadStr,
									"recipient":       pipe.PipelineName,
								}
								notifyPayload["template_variables"] = map[string]string{
									"pipeline_name": pipe.Name,
									"rule_name":     pipe.Name,
									"workflow_id":   wf.WorkflowID,
									"run_id":        wf.RunID,
									"workflow_type": wf.WorkflowType,
									"status":        wf.Status,
									"domain":        t.DomainName,
								}

								payloadBytes, _ := json.Marshal(notifyPayload)
								parsedBase, _ := url.Parse(t.NotifyHubURL)
								stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
								notifyURL := stripped.JoinPath("/v1/notifications").String()
								httpReq, _ := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
								httpReq.Header.Set("Content-Type", "application/json")
								httpReq.Header.Set("X-API-Key", t.NotifyHubAPIKey)

								client := &http.Client{Timeout: 15 * time.Second}
								resp, err := client.Do(httpReq)
								wfStatus := "sent"
								wfErrMsg := ""
								if err != nil {
									wfStatus = "failed"
									wfErrMsg = err.Error()
								} else {
									if resp.StatusCode >= 400 {
										wfStatus = "failed"
										respBody, _ := io.ReadAll(resp.Body)
										wfErrMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
									}
									resp.Body.Close()
								}

								now := time.Now()
								db.Exec(`
									INSERT INTO alert_history (tenant_id, alert_rule_id, tile_id, metric_type,
										metric_value, threshold, condition_type, channel, recipient, status, error_message, sent_at, workflow_id, run_id)
									VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
									t.ID, pipe.ID, "recent-failures", "workflow_failure", 0, pipe.Threshold,
									pipe.ConditionType, "pipeline", pipe.PipelineName, wfStatus, wfErrMsg, now, wf.WorkflowID, wf.RunID)

								if wfStatus == "sent" {
									if err := markPipelineWorkflowFailureTriggered(ctx, failureRow, now); err != nil {
										log.Printf("WARN: pipeline workflow failure mark triggered tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									}
								} else {
									if err := markPipelineWorkflowFailureFailed(ctx, failureRow, wfErrMsg, now); err != nil {
										log.Printf("WARN: pipeline workflow failure mark failed tenant=%d pipeline=%d workflow=%s run=%s: %v", t.ID, pipe.ID, wf.WorkflowID, wf.RunID, err)
									}
								}

								db.Exec(`UPDATE codefac_pipelines SET last_triggered_at = $1 WHERE id = $2`, now, pipe.ID)
								pipe.LastTriggeredAt = &now

								log.Printf("WORKFLOW FAILURE PIPELINE: tenant %d pipeline %q workflow %s/%s -> %s",
									t.ID, pipe.Name, wf.WorkflowID, wf.RunID, wfStatus)
							}
						}
						pipeRows.Close()
					}

					// ─── Alert Rule: Workflow Failure Evaluation ─────
					// Evaluate alert_rules with forward type or workflow_failure metric.
					// These rules trigger immediately on any workflow failure (no threshold/window).
					if len(recentPipelineFailures) > 0 {
						fwdRows, err := db.Query(`
							SELECT id, tenant_id, name, enabled, metric_type, condition_type, threshold,
								window_seconds, notification_channel, notification_target, notifyhub_template_id, message_template,
								ses_region, tile_id, alert_type, cooldown_seconds, last_triggered_at
							FROM alert_rules WHERE tenant_id = $1 AND enabled = true
							AND (alert_type = 'forward' OR metric_type IN ('workflow_failure', 'forward_workflow'))`, t.ID)
						if err == nil {
							for fwdRows.Next() {
								var fwdRule AlertRule
								if err := fwdRows.Scan(&fwdRule.ID, &fwdRule.TenantID, &fwdRule.Name, &fwdRule.Enabled,
									&fwdRule.MetricType, &fwdRule.ConditionType, &fwdRule.Threshold,
									&fwdRule.WindowSeconds, &fwdRule.NotificationChannel, &fwdRule.NotificationTarget,
									&fwdRule.NotifyHubTemplateID, &fwdRule.MessageTemplate, &fwdRule.SESRegion, &fwdRule.TileID, &fwdRule.AlertType, &fwdRule.CooldownSeconds, &fwdRule.LastTriggeredAt); err != nil {
									log.Printf("ERROR: workflow failure alert eval: scan rule: %v", err)
									continue
								}

								for _, wf := range recentPipelineFailures {
									if workflowAlertAlreadySent(fwdRule.ID, wf.WorkflowID, wf.RunID) {
										continue
									}
									if alertRuleInCooldown(fwdRule.LastTriggeredAt, fwdRule.CooldownSeconds) {
										continue
									}
									bodyMsg := fmt.Sprintf("Workflow failure alert %q triggered:\nWorkflow: %s\nRun: %s\nType: %s\nTasklist: %s\nStatus: %s\nClose Time: %s",
										fwdRule.Name, wf.WorkflowID, wf.RunID, wf.WorkflowType, wf.TaskList, wf.Status, wf.CloseTime)
									if fwdRule.MessageTemplate != "" {
										bodyMsg = fwdRule.MessageTemplate
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{rule_name}}", fwdRule.Name)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{alert_name}}", fwdRule.Name)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_type}}", "workflow_failure")
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_label}}", "workflow_failure")
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{metric_value}}", "1")
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{condition_type}}", "")
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{threshold}}", "0")
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{tenant_id}}", fmt.Sprintf("%d", t.ID))
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{workflow_id}}", wf.WorkflowID)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{run_id}}", wf.RunID)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{workflow_type}}", wf.WorkflowType)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{workflow-type}}", wf.WorkflowType)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{tasklist}}", wf.TaskList)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{status}}", wf.Status)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{close_time}}", wf.CloseTime)
										bodyMsg = strings.ReplaceAll(bodyMsg, "{{domain}}", t.DomainName)
									}
									bodyMsg = substituteWorkflowHistoryPlaceholders(bodyMsg, &t, wf.WorkflowID, wf.RunID)

									notifyPayload := map[string]interface{}{
										"idempotency_key": newUUIDv4(),
										"type":            "alert",
										"channels":        []string{fwdRule.NotificationChannel},
										"subject":         fmt.Sprintf("[WORKFLOW FAILURE] %s - %s", fwdRule.Name, wf.WorkflowType),
										"body":            bodyMsg,
										"recipient":       fwdRule.NotificationTarget,
									}
									if fwdRule.NotifyHubTemplateID != "" {
										notifyPayload["template_id"] = fwdRule.NotifyHubTemplateID
									}
									if fwdRule.NotificationChannel == "slack" && fwdRule.NotificationTarget != "" {
										notifyPayload["slack_channel"] = fwdRule.NotificationTarget
									}
									notifyPayload["template_variables"] = map[string]string{
										"rule_name":     fwdRule.Name,
										"rule_id":       fmt.Sprintf("%d", fwdRule.ID),
										"tile_id":       fwdRule.TileID,
										"metric_type":   "workflow_failure",
										"metric_value":  "1",
										"workflow_id":   wf.WorkflowID,
										"run_id":        wf.RunID,
										"workflow_type": wf.WorkflowType,
										"status":        wf.Status,
									}

									payloadBytes, err := json.Marshal(notifyPayload)
									if err != nil {
										log.Printf("ERROR: workflow failure alert eval: marshal payload: %v", err)
										continue
									}

									parsedBase, err := url.Parse(t.NotifyHubURL)
									if err != nil {
										log.Printf("ERROR: workflow failure alert eval: parse URL: %v", err)
										continue
									}
									stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
									notifyURL := stripped.JoinPath("/v1/notifications").String()
									httpReq, err := http.NewRequest(http.MethodPost, notifyURL, bytes.NewReader(payloadBytes))
									if err != nil {
										log.Printf("ERROR: workflow failure alert eval: create request: %v", err)
										continue
									}
									httpReq.Header.Set("Content-Type", "application/json")
									httpReq.Header.Set("X-API-Key", t.NotifyHubAPIKey)

									client := &http.Client{Timeout: 15 * time.Second}
									resp, err := client.Do(httpReq)
									wfStatus := "sent"
									wfErrMsg := ""
									if err != nil {
										wfStatus = "failed"
										wfErrMsg = err.Error()
									} else {
										if resp.StatusCode >= 400 {
											wfStatus = "failed"
											respBody, _ := io.ReadAll(resp.Body)
											wfErrMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
										}
										resp.Body.Close()
									}

									now := time.Now()
									db.Exec(`
										INSERT INTO alert_history (tenant_id, alert_rule_id, tile_id, metric_type,
											metric_value, threshold, condition_type, channel, recipient, status, error_message, sent_at, workflow_id, run_id)
										VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
										fwdRule.TenantID, fwdRule.ID, fwdRule.TileID, "workflow_failure", 1,
										0, "", fwdRule.NotificationChannel, fwdRule.NotificationTarget, wfStatus, wfErrMsg, now, wf.WorkflowID, wf.RunID)

									db.Exec(`UPDATE alert_rules SET last_triggered_at = $1 WHERE id = $2`, now, fwdRule.ID)
									fwdRule.LastTriggeredAt = &now

									log.Printf("WORKFLOW FAILURE ALERT: tenant %d rule %q workflow %s/%s -> %s",
										t.ID, fwdRule.Name, wf.WorkflowID, wf.RunID, wfStatus)
								}
							}
							fwdRows.Close()
						}
					}
				}

			}
		}
	}
}

// notifyhubWebhooksHandler handles GET /api/alerts/notifyhub-webhooks.
// It proxies to the tenant's NotifyHub instance to fetch vendor configs
// and returns only webhook-related configurations.
func notifyhubWebhooksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	// Load the tenant to get NotifyHub config
	tenant, err := tenantStore.GetByID(tenantID)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("get tenant: %v", err), http.StatusInternalServerError)
		return
	}
	if tenant == nil {
		writeJSONError(w, "tenant not found", http.StatusNotFound)
		return
	}
	if tenant.NotifyHubURL == "" {
		writeJSONError(w, "notifyhub_url not configured for this tenant", http.StatusBadRequest)
		return
	}

	// Call NotifyHub's vendor config endpoint
	// Use only the scheme+host from NotifyHubURL (strip any existing path)
	parsedBase, err := url.Parse(tenant.NotifyHubURL)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("invalid notifyhub_url: %v", err), http.StatusInternalServerError)
		return
	}
	stripped := &url.URL{Scheme: parsedBase.Scheme, Host: parsedBase.Host}
	vendorURL := stripped.JoinPath("/v1/admin/config/vendors").String()
	req, err := http.NewRequest(http.MethodGet, vendorURL, nil)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("create request: %v", err), http.StatusInternalServerError)
		return
	}
	req.Header.Set("X-API-Key", tenant.NotifyHubAPIKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("notifyhub request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		writeJSONError(w, fmt.Sprintf("notifyhub returned status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	// Parse the response
	var vendorConfigs []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&vendorConfigs); err != nil {
		writeJSONError(w, fmt.Sprintf("parse response: %v", err), http.StatusInternalServerError)
		return
	}

	// Filter for webhook-related configs
	webhookConfigs := make([]map[string]interface{}, 0)
	for _, cfg := range vendorConfigs {
		vt, ok := cfg["vendor_type"].(string)
		if !ok {
			continue
		}
		// Include any vendor type that contains "webhook"
		if strings.Contains(strings.ToLower(vt), "webhook") {
			webhookConfigs = append(webhookConfigs, cfg)
		}
	}

	writeJSON(w, webhookConfigs, http.StatusOK)
}

const (
	maxWorkflowHistoryPages = 500
	workflowHistoryPageSize = 100
)

// normalizeNextPageToken treats empty/null/[] tokens as no more pages.
func normalizeNextPageToken(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return ""
	}
	// Token may be a JSON string or a base64 byte array.
	var str string
	if err := json.Unmarshal(raw, &str); err == nil {
		return strings.TrimSpace(str)
	}
	var bytes []byte
	if err := json.Unmarshal(raw, &bytes); err == nil {
		if len(bytes) == 0 {
			return ""
		}
		return base64.StdEncoding.EncodeToString(bytes)
	}
	return s
}

// parseHistoryPageBody extracts events and nextPageToken from Cadence Web / Cadence API responses.
func parseHistoryPageBody(body []byte) ([]json.RawMessage, string, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		return nil, "", fmt.Errorf("decode history: %w", err)
	}

	var events []json.RawMessage
	var nextRaw json.RawMessage

	if h, ok := top["history"]; ok {
		var hist map[string]json.RawMessage
		if err := json.Unmarshal(h, &hist); err == nil {
			if ev, ok := hist["events"]; ok {
				_ = json.Unmarshal(ev, &events)
			}
			if tok, ok := hist["nextPageToken"]; ok {
				nextRaw = tok
			} else if tok, ok := hist["next_page_token"]; ok {
				nextRaw = tok
			}
		}
	}
	if len(events) == 0 {
		if ev, ok := top["events"]; ok {
			_ = json.Unmarshal(ev, &events)
		}
	}
	if len(nextRaw) == 0 {
		if tok, ok := top["nextPageToken"]; ok {
			nextRaw = tok
		} else if tok, ok := top["next_page_token"]; ok {
			nextRaw = tok
		}
	}

	return events, normalizeNextPageToken(nextRaw), nil
}

// fetchWorkflowHistoryPage fetches one page of workflow history from a Cadence Web URL.
func fetchWorkflowHistoryPage(ctx context.Context, requestURL string, audienceURL string) ([]json.RawMessage, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("create history request: %w", err)
	}
	if audienceURL != "" {
		token, err := getGCPIdentityToken(audienceURL)
		if err != nil {
			return nil, "", fmt.Errorf("GCP identity token for audience %s: %w", audienceURL, err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetch history: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, "", fmt.Errorf("read history: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		snippet := string(body)
		if len(snippet) > 2000 {
			snippet = snippet[:2000] + "..."
		}
		log.Printf("ERROR: cadence web history HTTP %d url=%s body=%s", resp.StatusCode, requestURL, snippet)
		return nil, "", fmt.Errorf("cadence web history HTTP %d: %s", resp.StatusCode, snippet)
	}
	return parseHistoryPageBody(body)
}

// fetchWorkflowHistoryAllPages downloads all history pages using pageSize + nextPageToken.
func fetchWorkflowHistoryAllPages(ctx context.Context, basePath string, audienceURL string) ([]json.RawMessage, error) {
	var allEvents []json.RawMessage
	nextPageToken := ""
	seenTokens := map[string]struct{}{"": {}}
	for page := 0; page < maxWorkflowHistoryPages; page++ {
		q := url.Values{}
		q.Set("pageSize", strconv.Itoa(workflowHistoryPageSize))
		if nextPageToken != "" {
			q.Set("nextPageToken", nextPageToken)
		}
		requestURL := basePath + "?" + q.Encode()
		events, token, err := fetchWorkflowHistoryPage(ctx, requestURL, audienceURL)
		if err != nil {
			return nil, err
		}
		allEvents = append(allEvents, events...)
		if token == "" {
			break
		}
		if _, dup := seenTokens[token]; dup {
			log.Printf("WARN: workflow history pagination stopped: repeated nextPageToken on page %d", page+1)
			break
		}
		seenTokens[token] = struct{}{}
		nextPageToken = token
	}
	if len(allEvents) == 0 {
		return nil, fmt.Errorf("no history events returned from %s", basePath)
	}
	return allEvents, nil
}

// fetchWorkflowHistory downloads all pages of workflow execution history from Cadence web.
// Tries cluster-scoped API first, then legacy v1 path.
func fetchWorkflowHistory(ctx context.Context, cadenceWebURL, domain, workflowID, runID, cluster, audienceURL string) ([]byte, error) {
	if cluster == "" {
		cluster = "cluster0"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cadenceWebURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("cadence_web_url is empty")
	}
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "http://" + baseURL
	}
	paths := []string{
		fmt.Sprintf("%s/api/domains/%s/%s/workflows/%s/%s/history",
			baseURL, url.PathEscape(domain), url.PathEscape(cluster), url.PathEscape(workflowID), url.PathEscape(runID)),
		fmt.Sprintf("%s/api/v1/domains/%s/workflows/%s/%s/history",
			baseURL, url.PathEscape(domain), url.PathEscape(workflowID), url.PathEscape(runID)),
	}
	var allEvents []json.RawMessage
	var errs []string
	for _, path := range paths {
		events, err := fetchWorkflowHistoryAllPages(ctx, path, audienceURL)
		if err == nil && len(events) > 0 {
			allEvents = events
			break
		}
		if err != nil {
			errs = append(errs, err.Error())
			if !strings.Contains(err.Error(), "HTTP 404") {
				continue
			}
		}
	}
	if len(allEvents) == 0 {
		if len(errs) > 0 {
			return nil, fmt.Errorf("%s", strings.Join(errs, "; "))
		}
		return nil, fmt.Errorf("no workflow history returned (check cadence_web_url, domain, and cluster)")
	}
	output, err := json.Marshal(map[string]interface{}{
		"workflow_id": workflowID,
		"run_id":      runID,
		"events":      allEvents,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal history: %w", err)
	}
	return output, nil
}

// workflowHistoryHandler handles GET /api/workflows/history.
func workflowHistoryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant_id", http.StatusBadRequest)
		return
	}
	var tenantID int
	if _, err := fmt.Sscanf(tenantIDStr, "%d", &tenantID); err != nil || tenantID <= 0 {
		writeJSONError(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	workflowID := strings.TrimSpace(r.URL.Query().Get("workflow_id"))
	runID := strings.TrimSpace(r.URL.Query().Get("run_id"))
	if workflowID == "" || runID == "" {
		writeJSONError(w, "workflow_id and run_id are required", http.StatusBadRequest)
		return
	}

	cluster := strings.TrimSpace(r.URL.Query().Get("cluster"))
	if cluster == "" {
		cluster = "cluster0"
	}

	tenant, err := tenantStore.GetByID(tenantID)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("tenant not found: %v", err), http.StatusNotFound)
		return
	}
	if tenant.CadenceWebURL == "" {
		writeJSONError(w, "cadence_web_url not configured for this tenant", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	log.Printf("INFO: fetching workflow history tenant=%d domain=%s workflow=%s run=%s cadence=%s",
		tenantID, tenant.DomainName, workflowID, runID, tenant.CadenceWebURL)

	userEmail := sessionEmailFromRequest(r)
	historyData, err := fetchWorkflowHistory(ctx, tenant.CadenceWebURL, tenant.DomainName, workflowID, runID, cluster, tenant.AudienceURL)
	if err != nil {
		log.Printf("ERROR: fetch workflow history tenant=%d user=%s workflow=%s/%s cadence=%s: %v",
			tenantID, userEmail, workflowID, runID, tenant.CadenceWebURL, err)
		writeJSONError(w, fmt.Sprintf("fetch workflow history: %v", err), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write(historyData); err != nil {
		log.Printf("ERROR: write workflow history response: %v", err)
	}
}

// uploadToGCS uploads data to a GCS bucket and returns the public URL.
// Environment variables:
//
//	WORKFLOW_HISTORY_STORAGE - auto (default), gcs, or inline
//	GCS_HISTORY_BUCKET       - GCS bucket name (required for gcs / auto+gcs)
//	GCS_HISTORY_PREFIX       - object path prefix (default "workflow-history")
//	GCS_ACCESS_TOKEN              - short-lived token override (optional)
//	GCS_SERVICE_ACCOUNT_KEY_FILE  - path to service account JSON key (or use GOOGLE_APPLICATION_CREDENTIALS)
//	GCS_SERVICE_ACCOUNT_EMAIL     - impersonate this SA via gcloud (requires iam.serviceAccountTokenCreator)
func uploadToGCS(data []byte, objectName string) (string, error) {
	bucket := getEnv("GCS_HISTORY_BUCKET", "")
	if bucket == "" {
		return "", fmt.Errorf("GCS_HISTORY_BUCKET not set")
	}
	prefix := getEnv("GCS_HISTORY_PREFIX", "workflow-history")

	objectPath := prefix + "/" + objectName

	// Get access token from metadata server or gcloud
	token, err := getGCPAccessToken()
	if err != nil {
		return "", fmt.Errorf("get GCP token: %w", err)
	}

	// Upload using GCS JSON API
	uploadURL := fmt.Sprintf("https://storage.googleapis.com/upload/storage/v1/b/%s/o?uploadType=media&name=%s",
		bucket, url.PathEscape(objectPath))

	req, err := http.NewRequest("POST", uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("create upload request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload to GCS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GCS upload: HTTP %d: %s", resp.StatusCode, string(body))
	}

	// Return the public URL
	gcsURL := fmt.Sprintf("https://storage.googleapis.com/%s/%s", bucket, objectPath)
	return gcsURL, nil
}

const gcsStorageScope = "https://www.googleapis.com/auth/devstorage.read_write"

var errGCPServiceAccountAuthNotConfigured = errors.New("gcp service account auth not configured")

// getGCPAccessToken obtains a GCP access token for GCS API calls.
func getGCPAccessToken() (string, error) {
	if token := strings.TrimSpace(os.Getenv("GCS_ACCESS_TOKEN")); token != "" {
		return token, nil
	}

	if token, err := getGCPAccessTokenFromServiceAccount(); err == nil {
		return token, nil
	} else if err != nil && !errors.Is(err, errGCPServiceAccountAuthNotConfigured) {
		return "", err
	}

	if token, err := getGCPAccessTokenFromMetadata(); err == nil {
		return token, nil
	}

	cmd := exec.Command("gcloud", "auth", "print-access-token")
	output, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(output)), nil
	}

	return "", fmt.Errorf(
		"no GCP access token available (set GCS_SERVICE_ACCOUNT_KEY_FILE, GCS_SERVICE_ACCOUNT_EMAIL, GCS_ACCESS_TOKEN, or use gcloud auth)",
	)
}

func getGCPAccessTokenFromMetadata() (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata token: HTTP %d", resp.StatusCode)
	}
	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("metadata token empty")
	}
	return result.AccessToken, nil
}

// getGCPAccessTokenFromServiceAccount uses a JSON key file or gcloud impersonation.
func getGCPAccessTokenFromServiceAccount() (string, error) {
	keyFile := strings.TrimSpace(getEnv("GCS_SERVICE_ACCOUNT_KEY_FILE", ""))
	if keyFile == "" {
		keyFile = strings.TrimSpace(os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
	}
	email := strings.TrimSpace(getEnv("GCS_SERVICE_ACCOUNT_EMAIL", ""))
	if keyFile == "" && email == "" {
		return "", errGCPServiceAccountAuthNotConfigured
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if keyFile != "" {
		data, err := os.ReadFile(keyFile)
		if err != nil {
			return "", fmt.Errorf("read service account key %s: %w", keyFile, err)
		}
		creds, err := google.CredentialsFromJSON(ctx, data, gcsStorageScope)
		if err != nil {
			return "", fmt.Errorf("parse service account key: %w", err)
		}
		tok, err := creds.TokenSource.Token()
		if err != nil {
			return "", fmt.Errorf("service account token: %w", err)
		}
		if tok.AccessToken == "" {
			return "", fmt.Errorf("service account token empty")
		}
		return tok.AccessToken, nil
	}

	cmd := exec.Command("gcloud", "auth", "print-access-token", "--impersonate-service-account="+email)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("impersonate %s: %w (needs gcloud and iam.serviceAccounts.getAccessToken)", email, err)
	}
	token := strings.TrimSpace(string(output))
	if token == "" {
		return "", fmt.Errorf("impersonate %s: empty token", email)
	}
	return token, nil
}

func main() {
	// Database connection
	databaseURL := getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/slo_dashboard?sslmode=disable")
	var err error
	db, err = sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("Failed to open database connection: %v", err)
	}
	defer db.Close()

	// Verify connectivity
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Printf("Connected to database")

	switch workflowHistoryStorageMode() {
	case "gcs":
		bucket := getEnv("GCS_HISTORY_BUCKET", "")
		if bucket == "" {
			log.Printf("WARN: WORKFLOW_HISTORY_STORAGE=gcs but GCS_HISTORY_BUCKET is not set; history uploads will fail")
		} else {
			log.Printf("Workflow history: GCS upload (bucket=%s, prefix=%s)", bucket, getEnv("GCS_HISTORY_PREFIX", "workflow-history"))
		}
	case "inline":
		log.Printf("Workflow history: inline JSON in Codefac/alert payloads")
	default:
		if workflowHistoryUseGCS() {
			log.Printf("Workflow history: GCS upload (bucket=%s, prefix=%s)", getEnv("GCS_HISTORY_BUCKET", ""), getEnv("GCS_HISTORY_PREFIX", "workflow-history"))
		} else {
			log.Printf("Workflow history: inline JSON (set GCS_HISTORY_BUCKET to upload to GCS)")
		}
	}

	// Ensure table exists
	if err := EnsureTable(db); err != nil {
		log.Fatalf("Failed to ensure tenants table: %v", err)
	}
	log.Printf("Tenants table ready")

	// Migration: add es_api_key column if it doesn't exist
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS es_api_key TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add es_api_key column: %v", err)
	}

	// Migration: add audience_url column for GCP identity token auth
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS audience_url TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add audience_url column: %v", err)
	}

	// Migration: add notifyhub columns
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notifyhub_url TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add notifyhub_url column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notifyhub_api_key TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add notifyhub_api_key column: %v", err)
	}

	// Migration: add cadence_web_url column
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cadence_web_url TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add cadence_web_url column: %v", err)
	}

	// Ensure alert_rules table exists
	if err := EnsureAlertsTable(db); err != nil {
		log.Fatalf("Failed to ensure alert_rules table: %v", err)
	}
	log.Printf("Alert rules table ready")

	// Migration: add tile_id column to alert_rules for per-tile alert association
	if _, err := db.Exec(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS tile_id TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add tile_id column: %v", err)
	}

	// Migration: add alert_type column to alert_rules
	if _, err := db.Exec(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS alert_type TEXT NOT NULL DEFAULT 'threshold'`); err != nil {
		log.Printf("WARN: could not add alert_type column: %v", err)
	}

	// Migration: add ses_region column to alert_rules for per-region SES alerts
	if _, err := db.Exec(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS ses_region TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add ses_region column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER NOT NULL DEFAULT 300`); err != nil {
		log.Printf("WARN: could not add cooldown_seconds column to alert_rules: %v", err)
	}

	// Ensure notification_channels table exists
	if err := EnsureNotificationChannelsTable(db); err != nil {
		log.Fatalf("Failed to ensure notification_channels table: %v", err)
	}
	log.Printf("Notification channels table ready")

	// Migration: add scope column to notification_channels
	if _, err := db.Exec(`ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'alert'`); err != nil {
		log.Printf("WARN: could not add scope column: %v", err)
	}
	// Drop old unique constraint and add new one with scope
	db.Exec(`ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_tenant_id_channel_key`)
	db.Exec(`ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_tenant_id_channel_scope_key UNIQUE (tenant_id, channel, scope)`)

	// Ensure reports table exists
	if err := EnsureReportsTable(db); err != nil {
		log.Fatalf("Failed to ensure reports table: %v", err)
	}
	log.Printf("Reports table ready")

	// Migration: add send_time and timezone columns to reports
	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS send_time TEXT NOT NULL DEFAULT '08:00'`); err != nil {
		log.Printf("WARN: could not add send_time column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'`); err != nil {
		log.Printf("WARN: could not add timezone column: %v", err)
	}

	// Ensure alert_history table exists
	if err := EnsureAlertHistoryTable(db); err != nil {
		log.Fatalf("Failed to ensure alert_history table: %v", err)
	}
	log.Printf("Alert history table ready")

	// Ensure workflow_failures table exists
	if err := EnsureWorkflowFailuresTable(db); err != nil {
		log.Fatalf("Failed to ensure workflow_failures table: %v", err)
	}
	log.Printf("Workflow failures table ready")

	// Ensure codefac_pipelines table exists
	if err := EnsureCodefacPipelinesTable(db); err != nil {
		log.Fatalf("Failed to ensure codefac_pipelines table: %v", err)
	}
	log.Printf("Codefac pipelines table ready")
	if err := EnsurePipelineWorkflowFailuresTable(db); err != nil {
		log.Fatalf("Failed to ensure pipeline_workflow_failures table: %v", err)
	}
	log.Printf("Pipeline workflow failures table ready")
	if err := EnsureWorkflowRCATable(db); err != nil {
		log.Fatalf("Failed to ensure workflow_rca_reports table: %v", err)
	}
	log.Printf("Workflow RCA reports table ready")

	if _, err := db.Exec(`ALTER TABLE codefac_pipelines ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER NOT NULL DEFAULT 300`); err != nil {
		log.Printf("WARN: could not add cooldown_seconds column to codefac_pipelines: %v", err)
	}

	// Ensure rbac table exists
	if err := EnsureRBACTable(db); err != nil {
		log.Fatalf("Failed to ensure rbac table: %v", err)
	}
	log.Printf("RBAC table ready")
	if _, err := db.Exec(`
		UPDATE rbac
		SET permissions = array_append(permissions, 'pipeline-requests'),
		    updated_at = NOW()
		WHERE permissions @> ARRAY['notifications']::TEXT[]
		  AND NOT permissions @> ARRAY['pipeline-requests']::TEXT[]`); err != nil {
		log.Printf("WARN: could not backfill pipeline-requests permissions: %v", err)
	}

	// Initialize tenant store
	tenantStore = &TenantStore{DB: db}

	// Seed default tenant if table is empty
	if err := tenantStore.SeedDefault(); err != nil {
		log.Fatalf("Failed to seed default tenant: %v", err)
	}

	// Log registered tenants
	tenants, err := tenantStore.List()
	if err != nil {
		log.Printf("WARN: could not list tenants: %v", err)
	} else {
		log.Printf("Registered tenants:")
		for _, t := range tenants {
			log.Printf("  [%d] %s (domain: %s, es: %s, index: %s)",
				t.ID, t.Name, t.DomainName, t.ESEndpoint, t.ESIndex)
		}
	}

	// Port
	port := getEnv("PORT", "8081")

	// Read ADMIN_KEY for one-time admin setup
	adminKey := getEnv("ADMIN_KEY", "")
	if adminKey != "" {
		log.Printf("ADMIN_KEY is set — one-time admin setup is available via POST /api/rbac/setup-admin")
	}

	log.Printf("Starting Cadence Workflow Rate Dashboard backend (multi-tenant)")
	log.Printf("  Port: %s", port)

	workflowFailureQueue = make(chan workflowFailureEnrichmentJob, workflowFailureQueueSize)

	// Purge expired sessions every hour
	go func() {
		for range time.Tick(time.Hour) {
			sessions.Range(func(k, v any) bool {
				if s, ok := v.(session); ok && time.Now().After(s.Expiry) {
					sessions.Delete(k)
				}
				return true
			})

			// Purge old notified failure entries (older than 1 hour)
			cutoff := time.Now().Add(-1 * time.Hour)
			notifiedFailures.Range(func(k, v any) bool {
				if ts, ok := v.(time.Time); ok && ts.Before(cutoff) {
					notifiedFailures.Delete(k)
				}
				return true
			})

			// Purge triggered rules (just clear the whole map periodically)
			triggeredRules.Range(func(k, v any) bool {
				triggeredRules.Delete(k)
				return true
			})
		}
	}()

	// Register routes — auth endpoints are public; everything else requires a valid session
	http.HandleFunc("/api/auth/verify", corsMiddleware(authVerifyHandler))
	http.HandleFunc("/api/auth/me", corsMiddleware(authMeHandler))
	http.HandleFunc("/api/codefac/rca", corsMiddleware(codefacRCAIngestHandler))
	http.HandleFunc("/api/workflows", corsMiddleware(requireAuth(workflowsHandler)))
	http.HandleFunc("/api/workflows/history", corsMiddleware(requireAuth(workflowHistoryHandler)))
	http.HandleFunc("/api/tenants", corsMiddleware(requireAuth(tenantsHandler)))
	http.HandleFunc("/api/tenants/delete", corsMiddleware(requireAuth(tenantDeleteHandler)))
	http.HandleFunc("/api/ses-metrics", corsMiddleware(requireAuth(sesMetricsHandler)))
	http.HandleFunc("/api/ses-regions", corsMiddleware(requireAuth(sesRegionsHandler)))
	http.HandleFunc("/api/ses-debug", corsMiddleware(requireAuth(sesDebugHandler)))

	http.HandleFunc("/api/rbac/setup-admin", corsMiddleware(rbacSetupAdminHandler))
	http.HandleFunc("/api/rbac/users", corsMiddleware(requirePermission("peoples")(rbacUsersHandler)))
	http.HandleFunc("/api/rbac/user-tenants", corsMiddleware(requireAuth(rbacUserTenantsHandler)))
	http.HandleFunc("/api/alerts/config", corsMiddleware(requirePermission("notifications")(alertsConfigHandler)))
	http.HandleFunc("/api/alerts/rules", corsMiddleware(requirePermission("notifications")(alertsRulesHandler)))
	http.HandleFunc("/api/alerts/rules/test", corsMiddleware(requirePermission("notifications")(alertsRulesTestHandler)))
	http.HandleFunc("/api/codefac-pipelines", corsMiddleware(requirePermission("notifications")(codefacPipelinesHandler)))
	http.HandleFunc("/api/codefac-pipelines/trigger", corsMiddleware(requirePermission("notifications")(codefacPipelineTriggerHandler)))
	http.HandleFunc("/api/pipeline-requests", corsMiddleware(requirePermission("pipeline-requests")(pipelineWorkflowFailuresHandler)))
	http.HandleFunc("/api/notification-channels", corsMiddleware(requirePermission("notifications")(notificationChannelsHandler)))
	http.HandleFunc("/api/reports", corsMiddleware(requirePermission("report-history")(reportsHandler)))
	http.HandleFunc("/api/reports/trigger", corsMiddleware(requirePermission("report-history")(reportTriggerHandler)))
	http.HandleFunc("/api/alerts/history", corsMiddleware(requirePermission("report-history")(alertHistoryHandler)))
	http.HandleFunc("/api/alerts/notifyhub-webhooks", corsMiddleware(requirePermission("notifications")(notifyhubWebhooksHandler)))
	http.HandleFunc("/api/rbac", corsMiddleware(requireAuth(rbacHandler)))
	http.HandleFunc("/api/rbac/my-access", corsMiddleware(requireAuth(rbacMyAccessHandler)))
	http.HandleFunc("/health", corsMiddleware(healthHandler))

	// Start background data refreshers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	startWorkflowFailureWorkers(ctx, workflowFailureWorkerCount)
	go startDashboardRefresher(ctx)
	go startSESRefresher(ctx)
	go startAlertEvaluator(ctx)

	// Serve frontend static files (built by Vite) with SPA fallback
	frontendDir := getEnv("FRONTEND_DIR", "./frontend")
	log.Printf("Serving frontend from: %s", frontendDir)
	fs := http.FileServer(http.Dir(frontendDir))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// If the request path has an extension (e.g. .js, .css, .png), serve the file directly
		// Otherwise, serve index.html for SPA client-side routing
		if ext := r.URL.Path; ext != "" {
			for i := len(ext) - 1; i >= 0; i-- {
				if ext[i] == '.' {
					fs.ServeHTTP(w, r)
					return
				}
				if ext[i] == '/' {
					break
				}
			}
		}
		// Fallback to index.html for SPA routes
		http.ServeFile(w, r, frontendDir+"/index.html")
	})

	// Start server
	addr := ":" + port
	log.Printf("Listening on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
