package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	_ "github.com/lib/pq"
)

// ============================================================
// Configuration (per-tenant, populated at request time)
// ============================================================

// Config holds the per-tenant configuration needed for ES queries.
type Config struct {
	ES         string
	Index      string
	DomainID   string
	DomainName string
	ESApiKey   string
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
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	DomainID   string    `json:"domain_id"`
	DomainName string    `json:"domain_name"`
	ESEndpoint string    `json:"es_endpoint"`
	ESIndex    string    `json:"es_index"`
	ESApiKey   string    `json:"es_api_key"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
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
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, created_at, updated_at
		 FROM tenants ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	defer rows.Close()

	var tenants []Tenant
	for rows.Next() {
		var t Tenant
		if err := rows.Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.CreatedAt, &t.UpdatedAt); err != nil {
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
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, created_at, updated_at
		 FROM tenants WHERE id = $1`, id).
		Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tenant %d: %w", id, err)
	}
	return &t, nil
}

// Create inserts a new tenant and returns it.
func (s *TenantStore) Create(name, domainID, domainName, esEndpoint, esIndex, esApiKey string) (*Tenant, error) {
	var t Tenant
	err := s.DB.QueryRow(
		`INSERT INTO tenants (name, domain_id, domain_name, es_endpoint, es_index, es_api_key)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key, created_at, updated_at`,
		name, domainID, domainName, esEndpoint, esIndex, esApiKey).
		Scan(&t.ID, &t.Name, &t.DomainID, &t.DomainName,
			&t.ESEndpoint, &t.ESIndex, &t.ESApiKey, &t.CreatedAt, &t.UpdatedAt)
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

	// Check if any tenant exists
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM tenants`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check tenant count: %w", err)
	}

	if count == 0 {
		// Table is empty — create default tenant
		tenant, err := s.Create(name, domainID, domainName, esEndpoint, esIndex, esApiKey)
		if err != nil {
			return fmt.Errorf("seed default tenant: %w", err)
		}
		log.Printf("Seeded default tenant: id=%d name=%q", tenant.ID, tenant.Name)
		return nil
	}

	// Check if the first tenant has an empty domain_id and update it
	var firstTenant Tenant
	err = s.DB.QueryRow(
		`SELECT id, name, domain_id, domain_name, es_endpoint, es_index, es_api_key FROM tenants ORDER BY id ASC LIMIT 1`).
		Scan(&firstTenant.ID, &firstTenant.Name, &firstTenant.DomainID, &firstTenant.DomainName,
			&firstTenant.ESEndpoint, &firstTenant.ESIndex, &firstTenant.ESApiKey)
	if err != nil {
		return fmt.Errorf("check first tenant: %w", err)
	}

	// Only update if domain_id is empty (stub tenant from previous run without env vars)
	if firstTenant.DomainID == "" && domainID != "" {
		_, err := s.DB.Exec(
			`UPDATE tenants SET name=$1, domain_id=$2, domain_name=$3, es_endpoint=$4, es_index=$5, es_api_key=$6, updated_at=NOW() WHERE id=$7`,
			name, domainID, domainName, esEndpoint, esIndex, esApiKey, firstTenant.ID)
		if err != nil {
			return fmt.Errorf("update stub tenant %d: %w", firstTenant.ID, err)
		}
		log.Printf("Updated stub tenant id=%d with env defaults: name=%q domain=%q", firstTenant.ID, name, domainName)
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

	// Optionally verify the audience matches our client ID.
	if clientID := getEnv("GOOGLE_CLIENT_ID", ""); clientID != "" && info.Aud != clientID {
		writeJSONError(w, "token audience mismatch", http.StatusUnauthorized)
		return
	}

	// Enforce @appointy.com domain.
	if !strings.HasSuffix(info.Email, "@appointy.com") && info.HD != "appointy.com" {
		writeJSONError(w, "access restricted to @appointy.com accounts", http.StatusForbidden)
		return
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
		writeJSONError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	val, ok := sessions.Load(token)
	if !ok {
		writeJSONError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s := val.(session)
	if time.Now().After(s.Expiry) {
		sessions.Delete(token)
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
	return strings.TrimPrefix(auth, "Bearer ")
}

// requireAuth wraps a handler and returns 401 if the request has no valid session.
func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		val, ok := sessions.Load(token)
		if !ok {
			writeJSONError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if s := val.(session); time.Now().After(s.Expiry) {
			sessions.Delete(token)
			writeJSONError(w, "session expired", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
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
	WorkflowID   string `json:"workflow_id"`
	WorkflowType string `json:"workflow_type"`
	TaskList     string `json:"tasklist"`
	Status       string `json:"status"`
	CloseTime    string `json:"close_time"`
}

// TasklistLatencyEntry holds average latency for a single tasklist.
type TasklistLatencyEntry struct {
	Tasklist      string  `json:"tasklist"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
	WorkflowCount int     `json:"workflow_count"`
}

// P100ByWorkflowEntry represents the P100 (max) latency for a workflow type.
type P100ByWorkflowEntry struct {
	WorkflowType  string `json:"workflow_type"`
	Count         int    `json:"count"`
	P100LatencyMs int64  `json:"p100_latency_ms"`
}

// ActivityErrorEntry represents a single activity error type and its count in open workflows.
type ActivityErrorEntry struct {
	WorkflowType string `json:"workflow_type"`
	Error        string `json:"error"`
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
	DomainName      string                 `json:"domain_name"`
	TenantID        int                    `json:"tenant_id"`
	Timestamp       string                 `json:"timestamp"`
	Windows         []WindowData           `json:"windows"`
	Rates30min      RateData               `json:"rates_30min"`
	Rates1hr        RateData               `json:"rates_1hr"`
	Rates1d         RateData               `json:"rates_1d"`
	Rates7d         RateData               `json:"rates_7d"`
	Rates30d        RateData               `json:"rates_30d"`
	RecentFailed    []RecentWorkflow       `json:"recent_failed"`
	TotalFailed     int                    `json:"total_failed"`
	TasklistLatency []TasklistLatencyEntry `json:"tasklist_latency"`
	ActivityErrors  []ActivityErrorEntry   `json:"activity_errors"`
	P100ByWorkflow  []P100ByWorkflowEntry  `json:"p100_by_workflow"`
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
	Key         string     `json:"key"`
	DocCount    int        `json:"doc_count"`
	MaxDuration esMaxValue `json:"max_duration"`
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

	// --- Window queries ---
	for _, w := range windows {
		fromNanos := nowNanos - (w.Seconds * 1_000_000_000)

		// Header line
		header := map[string]string{"index": cfg.Index}
		_ = enc.Encode(header)

		// Query body
		body := buildWindowQuery(fromNanos, nowNanos, domainFilter)
		_ = enc.Encode(body)
	}

	// --- Recent failed/timed-out workflows (combined, statusFilter determines which statuses) ---
	header := map[string]string{"index": cfg.Index}
	_ = enc.Encode(header)
	_ = enc.Encode(buildRecentQuery(statusFilter, domainFilter, limit, tasklistFilter, fromNanos, toNanos, offset))

	// --- Tasklist avg latency ---
	_ = enc.Encode(header)
	_ = enc.Encode(buildTasklistLatencyQuery(nowNanos, domainFilter, tasklistWindow))

	// --- Activity errors (with status filter) ---
	if activityErrorField != "" {
		_ = enc.Encode(header)
		_ = enc.Encode(buildActivityErrorQuery(domainFilter, activityErrorField, activityStatusConditions, activityErrorDetailField))
	}

	// --- P100 latency by workflow type (top 100 completed workflows) ---
	_ = enc.Encode(header)
	_ = enc.Encode(buildP100ByWorkflowTypeQuery(nowNanos, domainFilter))

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
					"term": map[string]int{"CloseStatus": 0},
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

	if len(statuses) == 1 {
		must = append(must, map[string]interface{}{
			"term": map[string]int{"CloseStatus": statuses[0]},
		})
	} else {
		must = append(must, map[string]interface{}{
			"terms": map[string]interface{}{"CloseStatus": statuses},
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
func buildTasklistLatencyQuery(nowNanos int64, domainFilter []interface{}, windowSeconds int64) map[string]interface{} {
	fromNanos := nowNanos - (windowSeconds * 1_000_000_000)

	must := []interface{}{
		map[string]interface{}{
			"term": map[string]int{"CloseStatus": 0},
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
						"terms": map[string]interface{}{"CloseStatus": []int{1, 5}},
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
					"term": map[string]int{"CloseStatus": sc},
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
func buildP100ByWorkflowTypeQuery(nowNanos int64, domainFilter []interface{}) map[string]interface{} {
	must := []interface{}{
		map[string]interface{}{
			"term": map[string]int{"CloseStatus": 0},
		},
	}

	for _, f := range domainFilter {
		must = append(must, f)
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": must,
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
			switch b.Key {
			case 0: // Completed
				completed = b.DocCount
			case 1: // Failed
				failed = b.DocCount
			case 4: // Cancelled / ContinuedAsNew
				cancelled = b.DocCount
			case 5: // TimedOut
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

// parseRecentHits extracts recent failed/timed-out workflows from ES response hits.
func parseRecentHits(resp esResponse) []RecentWorkflow {
	hits := resp.Hits.Hits
	if len(hits) == 0 {
		return nil
	}

	statusMap := map[int]string{
		1: "Failed",
		5: "TimedOut",
	}

	result := make([]RecentWorkflow, 0, len(hits))
	for _, hit := range hits {
		src := hit.Source
		closeTimeStr := formatCloseTime(src.CloseTime)

		statusLabel := statusMap[src.CloseStatus]
		if statusLabel == "" {
			statusLabel = fmt.Sprintf("Status:%d", src.CloseStatus)
		}

		result = append(result, RecentWorkflow{
			WorkflowID:   src.WorkflowID,
			WorkflowType: src.WorkflowType,
			TaskList:     src.TaskList,
			Status:       statusLabel,
			CloseTime:    closeTimeStr,
		})
	}
	return result
}

// formatCloseTime converts a CloseTime from epoch nanoseconds (int64) to a readable string.
// CloseTime can also be null/missing.
func formatCloseTime(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "N/A"
	}

	var ns int64
	if err := json.Unmarshal(raw, &ns); err != nil {
		return "N/A"
	}

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
func queryElasticsearch(cfg Config, limit int, tasklistWindow int64, statusFilter []int, tasklistFilter []string, fromNanos, toNanos int64, offset int, activityErrorField string, activityStatusConditions []int, activityErrorDetailField string) (*esMultiSearchResponse, error) {
	nowNanos := time.Now().UnixNano()
	body := buildMsearchBody(cfg, nowNanos, limit, tasklistWindow, statusFilter, tasklistFilter, fromNanos, toNanos, offset, activityErrorField, activityStatusConditions, activityErrorDetailField)

	url := fmt.Sprintf("%s/_msearch", strings.TrimRight(cfg.ES, "/"))

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	if cfg.ESApiKey != "" {
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

// ============================================================
// Response Builder
// ============================================================

// buildResponse assembles the final APIResponse from the _msearch results.
func buildResponse(cfg Config, tenantID int, msResp *esMultiSearchResponse, limit int, statusFilter []int, activityErrorField string, activityErrorDetailField string) (APIResponse, int) {
	responses := msResp.Responses
	expected := len(windows) + 3 // window queries + recent failed/timed-out + tasklist latency + p100 by workflow type
	if activityErrorField != "" {
		expected++ // + activity error query
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
		if resp.Aggregations != nil && resp.Aggregations.P100ByWorkflow != nil {
			for _, b := range resp.Aggregations.P100ByWorkflow.Buckets {
				p100Ms := int64(0)
				if b.MaxDuration.Value > 0 {
					p100Ms = int64(b.MaxDuration.Value / 1_000_000)
				}
				p100ByWorkflow = append(p100ByWorkflow, P100ByWorkflowEntry{
					WorkflowType:  b.Key,
					Count:         b.DocCount,
					P100LatencyMs: p100Ms,
				})
			}
		}
	}

	ts := time.Now().Format("2006-01-02 15:04:05")

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
		return nil // default: no filter (show all)
	}

	statusMap := map[string]int{
		"open":           -1,
		"closed":         -2,
		"failed":         1,
		"completed":      2,
		"cancelled":      3,
		"terminated":     4,
		"timeout":        5,
		"continuedasnew": 6,
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

	// Parse activity_error_field from query string (default: "WorkflowType")
	activityErrorField := "WorkflowType"
	if aefStr := r.URL.Query().Get("activity_error_field"); aefStr != "" {
		activityErrorField = aefStr
	}

	// Parse activity_status_filter from query string for activity errors (comma-separated)
	// Values: open, closed, failed, completed, cancelled, terminated, timeout, continuedasnew
	activityStatusFilterStr := r.URL.Query().Get("activity_status_filter")
	activityStatusConditions := parseActivityErrorStatusFilter(activityStatusFilterStr)

	// Parse activity_error_detail_field from query string for actual error details
	activityErrorDetailField := ""
	if aedfStr := r.URL.Query().Get("activity_error_detail_field"); aedfStr != "" {
		activityErrorDetailField = aedfStr
	}

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

	// Build per-request config from tenant data
	cfg := Config{
		ES:         tenant.ESEndpoint,
		Index:      tenant.ESIndex,
		DomainID:   tenant.DomainID,
		DomainName: tenant.DomainName,
		ESApiKey:   tenant.ESApiKey,
	}

	// Query Elasticsearch
	msResp, err := queryElasticsearch(cfg, limit, tasklistWindow, statusFilter, tasklistFilter, fromNanos, toNanos, offset, activityErrorField, activityStatusConditions, activityErrorDetailField)
	if err != nil {
		log.Printf("ERROR: ES query failed: %v", err)
		writeJSONError(w, fmt.Sprintf("ES query failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Build the response
	apiResp, _ := buildResponse(cfg, tenant.ID, msResp, limit, statusFilter, activityErrorField, activityErrorDetailField)

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
		writeJSON(w, tenants, http.StatusOK)

	case http.MethodPost:
		var req struct {
			Name       string `json:"name"`
			DomainID   string `json:"domain_id"`
			DomainName string `json:"domain_name"`
			ESEndpoint string `json:"es_endpoint"`
			ESIndex    string `json:"es_index"`
			ESApiKey   string `json:"es_api_key"`
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
		if req.ESApiKey == "" {
			writeJSONError(w, "es_api_key is required", http.StatusBadRequest)
			return
		}

		// Use defaults for empty fields
		if req.ESEndpoint == "" {
			req.ESEndpoint = "http://localhost:9000"
		}
		if req.ESIndex == "" {
			req.ESIndex = "cadence-visibility"
		}

		tenant, err := tenantStore.Create(req.Name, req.DomainID, req.DomainName, req.ESEndpoint, req.ESIndex, req.ESApiKey)
		if err != nil {
			log.Printf("ERROR: create tenant: %v", err)
			writeJSONError(w, fmt.Sprintf("create tenant: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, tenant, http.StatusCreated)

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
	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(cfg.Region))
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

	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
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
// Main
// ============================================================

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

	// Ensure table exists
	if err := EnsureTable(db); err != nil {
		log.Fatalf("Failed to ensure tenants table: %v", err)
	}
	log.Printf("Tenants table ready")

	// Migration: add es_api_key column if it doesn't exist
	if _, err := db.Exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS es_api_key TEXT NOT NULL DEFAULT ''`); err != nil {
		log.Printf("WARN: could not add es_api_key column: %v", err)
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
	port := getEnv("PORT", "8080")

	log.Printf("Starting Cadence Workflow Rate Dashboard backend (multi-tenant)")
	log.Printf("  Port: %s", port)

	// Purge expired sessions every hour
	go func() {
		for range time.Tick(time.Hour) {
			sessions.Range(func(k, v any) bool {
				if s, ok := v.(session); ok && time.Now().After(s.Expiry) {
					sessions.Delete(k)
				}
				return true
			})
		}
	}()

	// Register routes — auth endpoints are public; everything else requires a valid session
	http.HandleFunc("/api/auth/verify", corsMiddleware(authVerifyHandler))
	http.HandleFunc("/api/auth/me", corsMiddleware(authMeHandler))
	http.HandleFunc("/api/workflows", corsMiddleware(requireAuth(workflowsHandler)))
	http.HandleFunc("/api/tenants", corsMiddleware(requireAuth(tenantsHandler)))
	http.HandleFunc("/api/tenants/delete", corsMiddleware(requireAuth(tenantDeleteHandler)))
	http.HandleFunc("/api/ses-metrics", corsMiddleware(requireAuth(sesMetricsHandler)))
	http.HandleFunc("/api/ses-regions", corsMiddleware(requireAuth(sesRegionsHandler)))
	http.HandleFunc("/api/ses-debug", corsMiddleware(requireAuth(sesDebugHandler)))
	http.HandleFunc("/health", corsMiddleware(healthHandler))

	// Serve frontend static files (built by Vite)
	frontendDir := getEnv("FRONTEND_DIR", "./frontend")
	log.Printf("Serving frontend from: %s", frontendDir)
	http.Handle("/", http.FileServer(http.Dir(frontendDir)))

	// Start server
	addr := ":" + port
	log.Printf("Listening on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
