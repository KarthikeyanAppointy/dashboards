SHELL := /bin/sh

VERSION ?= v0.2.003
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= notifyhub-builder

FRONTEND_DIR := frontend
BACKEND_DIR := backend
FRONTEND_ENV_FILE := $(FRONTEND_DIR)/.env
BACKEND_ENV_FILE := $(BACKEND_DIR)/.env
FRONTEND_PORT ?= 5173
BACKEND_PORT ?= 8081

LOAD_FRONTEND_ENV = test -f $(FRONTEND_ENV_FILE) || { echo "Missing $(FRONTEND_ENV_FILE)"; exit 1; }; set -a; . $(FRONTEND_ENV_FILE); set +a
LOAD_BACKEND_ENV = test -f $(BACKEND_ENV_FILE) || { echo "Missing $(BACKEND_ENV_FILE)"; exit 1; }; set -a; . $(BACKEND_ENV_FILE); set +a
RUN_FRONTEND = cd $(FRONTEND_DIR) &&
RUN_BACKEND = cd $(BACKEND_DIR) &&

VITE_GOOGLE_CLIENT_ID ?= 3161893293-u35lum0ev7ofrcnb3jbmr2hhi8s7634s.apps.googleusercontent.com
VITE_APPONTY_ONLY_LOGIN ?= true

BACKEND_IMAGE := technotech001/background-slo-backend
FRONTEND_IMAGE := technotech001/background-slo-frontend

.PHONY: all \
	dashboard-backend-build \
	dashboard-backend-start \
	dashboard-backend-stop \
	dashboard-frontend-build \
	dashboard-frontend-start \
	dashboard-frontend-stop \
	help \
	image-build-all \
	image-build-backend \
	image-build-backend-local \
	image-build-frontend \
	image-build-frontend-local \
	infra \
	infra-stop \
	image-inspect \
	lint-dockerfiles \
	image-push-all

all: dashboard-frontend-build dashboard-backend-build

infra:
	docker compose up -d postgres

infra-stop:
	docker compose stop postgres

dashboard-frontend-build:
	$(RUN_FRONTEND) npm run build

dashboard-frontend-start:
	$(LOAD_FRONTEND_ENV); $(RUN_FRONTEND) npm run dev

dashboard-frontend-stop:
	pids=$$(lsof -ti tcp:$(FRONTEND_PORT)); \
	if [ -n "$$pids" ]; then \
		kill $$pids; \
	else \
		echo "No process is listening on port $(FRONTEND_PORT)"; \
	fi

dashboard-backend-build:
	$(RUN_BACKEND) go build .

dashboard-backend-start:
	$(LOAD_BACKEND_ENV); $(RUN_BACKEND) go run main.go

dashboard-backend-stop:
	pids=$$(lsof -ti tcp:$(BACKEND_PORT)); \
	if [ -n "$$pids" ]; then \
		kill $$pids; \
	else \
		echo "No process is listening on port $(BACKEND_PORT)"; \
	fi

image-build-backend:
	docker buildx build --builder $(BUILDER) \
		--platform $(PLATFORMS) \
		-f docker/Dockerfile.backend \
		-t $(BACKEND_IMAGE):$(VERSION) \
		--push .

image-build-frontend:
	docker buildx build --builder $(BUILDER) \
		--platform $(PLATFORMS) \
		-f docker/Dockerfile.frontend \
		--build-arg VITE_GOOGLE_CLIENT_ID=$(VITE_GOOGLE_CLIENT_ID) \
		--build-arg VITE_APPONTY_ONLY_LOGIN=$(VITE_APPONTY_ONLY_LOGIN) \
		-t $(FRONTEND_IMAGE):$(VERSION) \
		--push .

image-build-all: image-build-backend image-build-frontend

image-push-all: image-build-all

image-inspect:
	docker buildx imagetools inspect $(BACKEND_IMAGE):$(VERSION)
	@echo "---"
	docker buildx imagetools inspect $(FRONTEND_IMAGE):$(VERSION)

# Convenience targets for local single-platform builds
image-build-backend-local:
	docker build -f docker/Dockerfile.backend -t $(BACKEND_IMAGE):$(VERSION) .

image-build-frontend-local:
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
	@echo
	@echo "Local development:"
	@echo "  make infra"
	@echo "  make infra-stop"
	@echo "  make dashboard-frontend-build"
	@echo "  make dashboard-frontend-start"
	@echo "  make dashboard-frontend-stop"
	@echo "  make dashboard-backend-build"
	@echo "  make dashboard-backend-start"
	@echo "  make dashboard-backend-stop"
	@echo
	@echo "Docker images:"
	@echo "  make image-build-backend"
	@echo "  make image-build-frontend"
	@echo "  make image-build-all"
	@echo "  make image-push-all"
	@echo "  make image-inspect"
	@echo "  make image-build-backend-local"
	@echo "  make image-build-frontend-local"
	@echo
	@echo "Local app default:"
	@echo "  make all"
	@echo
	@echo "Overrides:"
	@echo "  VERSION=$(VERSION)"
	@echo "  PLATFORMS=$(PLATFORMS)"
	@echo "  FRONTEND_PORT=$(FRONTEND_PORT)"
	@echo "  BACKEND_PORT=$(BACKEND_PORT)"
	@echo "  VITE_GOOGLE_CLIENT_ID=$(VITE_GOOGLE_CLIENT_ID)"
	@echo "  VITE_APPONTY_ONLY_LOGIN=$(VITE_APPONTY_ONLY_LOGIN)"

.DEFAULT_GOAL := help
} not found: background-slo/Makefile. Use the write tool to create new files.
