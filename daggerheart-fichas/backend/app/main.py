from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.auth import router as auth_router
from app.api.backups import router as backups_router
from app.api.character_event_stream import router as character_event_stream_router
from app.api.characters import router as characters_router
from app.api.errors import build_api_error_payload, build_validation_error_detail
from app.api.health import router as health_router
from app.api.metrics import router as metrics_router
from app.api.shared_characters import router as shared_characters_router
from app.core.config import Settings, get_settings
from app.core.observability import (
    ObservabilityMetrics,
    configure_structured_logging,
    log_event,
    mark_scope_api_error,
)
from app.core.rate_limit import create_rate_limiter
from app.middleware.csrf import CsrfProtectionMiddleware
from app.middleware.observability import RequestObservabilityMiddleware
from app.middleware.private_response_headers import PrivateResponseHeadersMiddleware
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.services.character_sse_lifecycle_service import CharacterStreamManager

settings = get_settings()
configure_structured_logging(
    enabled=settings.structured_logging_enabled,
    level=settings.log_level,
    max_field_length=settings.log_max_field_length,
    include_tracebacks=settings.log_include_exception_tracebacks,
    disable_uvicorn_access_log=settings.disable_uvicorn_access_log,
)
logger = logging.getLogger(__name__)
rate_limiter = create_rate_limiter(settings)
character_stream_manager = CharacterStreamManager()
metrics = ObservabilityMetrics(
    version=settings.api_version,
    environment=settings.app_env,
    enabled=settings.metrics_enabled,
)


@asynccontextmanager
async def lifespan(current_app: FastAPI):
    await current_app.state.character_stream_manager.start_accepting()
    log_event(
        logger,
        logging.INFO,
        "application.started",
        version=settings.api_version,
        environment=settings.app_env,
        metricsEnabled=settings.metrics_enabled,
        releaseRevision=settings.release_revision,
        cloudSnapshotWritesEnabled=settings.cloud_snapshot_writes_enabled,
        cloudMutationsEnabled=settings.cloud_mutations_enabled,
        characterSharingWritesEnabled=settings.character_sharing_writes_enabled,
        characterSseEnabled=settings.character_sse_enabled,
        sseMaxDurationSeconds=settings.character_event_stream_max_duration_seconds,
    )
    try:
        yield
    finally:
        active_streams = await current_app.state.character_stream_manager.begin_shutdown()
        log_event(
            logger,
            logging.INFO,
            "character.stream.drain_started",
            activeConnections=active_streams,
            graceSeconds=settings.character_event_shutdown_grace_seconds,
        )
        drained = await current_app.state.character_stream_manager.wait_for_drain(
            settings.character_event_shutdown_grace_seconds
        )
        log_event(
            logger,
            logging.INFO if drained else logging.WARNING,
            "character.stream.drain_completed",
            drained=drained,
            remainingConnections=current_app.state.character_stream_manager.active_count,
        )
        await current_app.state.rate_limiter.close()
        log_event(logger, logging.INFO, "application.stopped")


app = FastAPI(
    title=settings.app_name,
    version=settings.api_version,
    lifespan=lifespan,
    docs_url="/docs" if settings.effective_api_docs_enabled else None,
    redoc_url="/redoc" if settings.effective_api_docs_enabled else None,
    openapi_url="/openapi.json" if settings.effective_api_docs_enabled else None,
)
app.state.settings = settings
app.state.rate_limiter = rate_limiter
app.state.character_stream_manager = character_stream_manager
app.state.metrics = metrics

app.add_middleware(
    RequestBodyLimitMiddleware,
    max_bytes=settings.max_request_body_bytes,
)
app.add_middleware(PrivateResponseHeadersMiddleware)
app.add_middleware(
    CsrfProtectionMiddleware,
    enabled=settings.csrf_enabled,
    session_cookie_name=settings.effective_session_cookie_name,
    csrf_cookie_name=settings.effective_csrf_cookie_name,
    csrf_header_name=settings.csrf_header_name,
    secret=settings.session_secret,
    trusted_origins=settings.effective_csrf_trusted_origins,
    request_id_header_name=settings.request_id_header_name,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=list(settings.effective_cors_allowed_headers),
    expose_headers=[
        settings.request_id_header_name,
        settings.csrf_header_name,
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Retry-After",
    ],
    max_age=settings.cors_max_age_seconds,
)
app.add_middleware(
    RequestObservabilityMiddleware,
    metrics=metrics,
    log_successful_requests=settings.log_successful_http_requests,
    metrics_path="/metrics",
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.trusted_hosts,
)
app.add_middleware(
    SecurityHeadersMiddleware,
    enabled=settings.security_headers_enabled,
    content_security_policy=settings.content_security_policy,
    referrer_policy=settings.referrer_policy,
    permissions_policy=settings.permissions_policy,
    hsts_enabled=settings.effective_hsts_enabled,
    hsts_max_age_seconds=settings.hsts_max_age_seconds,
    hsts_include_subdomains=settings.hsts_include_subdomains,
    hsts_preload=settings.hsts_preload,
)
app.add_middleware(
    RequestIdMiddleware,
    header_name=settings.request_id_header_name,
    max_length=settings.request_id_max_length,
    accept_incoming=settings.accept_incoming_request_id,
)


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    detail: Any = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    response_headers = dict(headers or {})
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        current_settings: Settings = request.app.state.settings
        response_headers[current_settings.request_id_header_name] = request_id

    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(build_api_error_payload(code, message, detail)),
        headers=response_headers,
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "code" in exc.detail and "message" in exc.detail:
        mark_scope_api_error(request.scope, code=str(exc.detail["code"]))
        return _error_response(
            request,
            status_code=exc.status_code,
            code=str(exc.detail["code"]),
            message=str(exc.detail["message"]),
            detail=exc.detail.get("detail"),
            headers=dict(exc.headers) if exc.headers is not None else None,
        )

    fallback_code = f"HTTP_{exc.status_code}"
    mark_scope_api_error(request.scope, code=fallback_code)
    return _error_response(
        request,
        status_code=exc.status_code,
        code=fallback_code,
        message=str(exc.detail),
        headers=dict(exc.headers) if exc.headers is not None else None,
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    current_settings: Settings = request.app.state.settings
    mark_scope_api_error(request.scope, code="REQUEST_VALIDATION_FAILED")
    return _error_response(
        request,
        status_code=422,
        code="REQUEST_VALIDATION_FAILED",
        message="The request payload or parameters are invalid.",
        detail=build_validation_error_detail(
            exc.errors(),
            max_errors=current_settings.request_validation_max_errors,
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, _exc: Exception) -> JSONResponse:
    # Never expose exception text, SQL, secrets, or stack traces to API clients.
    mark_scope_api_error(request.scope, code="INTERNAL_SERVER_ERROR")
    log_event(
        logger,
        logging.ERROR,
        "http.request.unhandled_error",
        exc_info=True,
        method=request.method,
        route=getattr(request.scope.get("route"), "path", "unmatched"),
    )
    return _error_response(
        request,
        status_code=500,
        code="INTERNAL_SERVER_ERROR",
        message="An unexpected server error occurred.",
    )


app.include_router(health_router)
app.include_router(metrics_router)
app.include_router(auth_router)
app.include_router(backups_router)
app.include_router(characters_router)
app.include_router(shared_characters_router)
app.include_router(character_event_stream_router)
