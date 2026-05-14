# =============================================================================
# Stage 1: Build Go backend binary
# =============================================================================
FROM golang:1.25-alpine AS backend-builder

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /build

# Copy dependency files first for better layer caching
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy the rest of the backend source
COPY backend/ .

# Build a statically-linked binary
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /build/server \
    .

# =============================================================================
# Stage 2: Build React frontend
# =============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /build

# Copy dependency files first for better layer caching
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy the rest of the frontend source and build
COPY frontend/ .
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# =============================================================================
# Stage 3: Final minimal runtime image
# =============================================================================
FROM alpine:3.21

# Install runtime dependencies: ca-certificates for HTTPS calls, tzdata for timezone support
RUN apk add --no-cache ca-certificates tzdata

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy the Go binary from the backend builder
COPY --from=backend-builder /build/server .

# Copy the built frontend files (Vite outputs to 'dist')
COPY --from=frontend-builder /build/dist ./frontend

# Ensure proper ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/health || exit 1

# Environment variables (with sensible defaults)
ENV PORT=8080
ENV FRONTEND_DIR=/app/frontend
ENV DATABASE_URL="postgres://postgres:postgres@localhost:5432/slo_dashboard?sslmode=disable"

# Run the Go server (serves both API and frontend)
ENTRYPOINT ["/app/server"]
