# =============================================================================
# SLO Dashboard - Multi-platform Docker Image Builder
# =============================================================================

# Image version (override with VERSION=v0.x.y)
VERSION ?= v0.2.003

# Target platforms (override with PLATFORMS=linux/amd64)
PLATFORMS ?= linux/amd64,linux/arm64

# Docker builder instance
BUILDER ?= notifyhub-builder

# Frontend build-time env vars (required for Vite Google OAuth)
VITE_GOOGLE_CLIENT_ID ?= 3161893293-u35lum0ev7ofrcnb3jbmr2hhi8s7634s.apps.googleusercontent.com
VITE_APPONTY_ONLY_LOGIN ?= true

# Image repositories
BACKEND_IMAGE := technotech001/background-slo-backend
FRONTEND_IMAGE := technotech001/background-slo-frontend

# =============================================================================
.PHONY: all build-backend build-frontend push-all inspect

all: build-backend build-frontend

build-backend:
	docker buildx build --builder $(BUILDER) \
		--platform $(PLATFORMS) \
		-f docker/Dockerfile.backend \
		-t $(BACKEND_IMAGE):$(VERSION) \
		--push .

build-frontend:
	docker buildx build --builder $(BUILDER) \
		--platform $(PLATFORMS) \
		-f docker/Dockerfile.frontend \
		--build-arg VITE_GOOGLE_CLIENT_ID=$(VITE_GOOGLE_CLIENT_ID) \
		--build-arg VITE_APPONTY_ONLY_LOGIN=$(VITE_APPONTY_ONLY_LOGIN) \
		-t $(FRONTEND_IMAGE):$(VERSION) \
		--push .

push-all: all

inspect:
	docker buildx imagetools inspect $(BACKEND_IMAGE):$(VERSION)
	@echo "---"
	docker buildx imagetools inspect $(FRONTEND_IMAGE):$(VERSION)

# Convenience targets for local single-platform builds
build-backend-local:
	docker build -f docker/Dockerfile.backend -t $(BACKEND_IMAGE):$(VERSION) .

build-frontend-local:
	docker build \
		-f docker/Dockerfile.frontend \
		--build-arg VITE_GOOGLE_CLIENT_ID=$(VITE_GOOGLE_CLIENT_ID) \
		--build-arg VITE_APPONTY_ONLY_LOGIN=$(VITE_APPONTY_ONLY_LOGIN) \
		-t $(FRONTEND_IMAGE):$(VERSION) .

lint-dockerfiles:
	docker run --rm -i hadolint/hadolint < docker/Dockerfile.backend
	docker run --rm -i hadolint/hadolint < docker/Dockerfile.frontend

help:
	@echo "SLO Dashboard Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make build-backend        Build and push backend image"
	@echo "  make build-frontend       Build and push frontend image"
	@echo "  make all                  Build and push both images"
	@echo "  make inspect              Inspect multi-arch manifests"
	@echo "  make build-backend-local  Build backend locally (no push)"
	@echo "  make build-frontend-local Build frontend locally (no push)"
	@echo ""
	@echo "Variables:"
	@echo "  VERSION=$(VERSION)"
	@echo "  PLATFORMS=$(PLATFORMS)"
	@echo "  VITE_GOOGLE_CLIENT_ID=$(VITE_GOOGLE_CLIENT_ID)"
	@echo "  VITE_APPONTY_ONLY_LOGIN=$(VITE_APPONTY_ONLY_LOGIN)"
	@echo ""
	@echo "Examples:"
	@echo "  make all VERSION=v0.2.004"
	@echo "  make build-backend PLATFORMS=linux/amd64"
	@echo "  make build-frontend VITE_GOOGLE_CLIENT_ID=other-id.apps.googleusercontent.com"

.DEFAULT_GOAL := help
} not found: background-slo/Makefile. Use the write tool to create new files.