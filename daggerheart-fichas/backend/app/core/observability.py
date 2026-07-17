from __future__ import annotations

import json
import logging
import math
import re
import sys
from collections import defaultdict
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from time import perf_counter
from typing import Any, Literal

from app.core.request_context import get_request_id

MetricOutcome = Literal["allowed", "blocked", "bypassed", "unavailable"]

_METRIC_NAME_PATTERN = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")
_LABEL_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_SAFE_EVENT_PATTERN = re.compile(r"^[a-z][a-z0-9_.-]{2,95}$")
_FORBIDDEN_LOG_FIELD_PARTS = {
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "email",
    "payload",
    "snapshot",
    "patch",
    "operations",
    "content",
    "inventory",
    "story",
}
_DEFAULT_HISTOGRAM_BUCKETS = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
)


def _escape_prometheus_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _format_number(value: float) -> str:
    if math.isinf(value):
        return "+Inf" if value > 0 else "-Inf"
    if math.isnan(value):
        return "NaN"
    if value.is_integer():
        return str(int(value))
    return format(value, ".12g")


def _labels_text(label_names: tuple[str, ...], label_values: tuple[str, ...]) -> str:
    if not label_names:
        return ""
    pairs = ",".join(
        f'{name}="{_escape_prometheus_label(value)}"'
        for name, value in zip(label_names, label_values, strict=True)
    )
    return "{" + pairs + "}"


@dataclass(frozen=True, slots=True)
class _MetricDefinition:
    name: str
    help: str
    metric_type: Literal["counter", "gauge", "histogram"]
    labels: tuple[str, ...] = ()
    buckets: tuple[float, ...] = ()

    def __post_init__(self) -> None:
        if not _METRIC_NAME_PATTERN.fullmatch(self.name):
            raise ValueError(f"invalid metric name: {self.name}")
        if any(not _LABEL_NAME_PATTERN.fullmatch(label) for label in self.labels):
            raise ValueError(f"invalid label name for metric: {self.name}")
        if (
            self.metric_type == "histogram"
            and (not self.buckets or tuple(sorted(set(self.buckets))) != self.buckets)
        ):
            raise ValueError(f"histogram buckets must be unique and sorted: {self.name}")


@dataclass(slots=True)
class _HistogramValue:
    count: int = 0
    total: float = 0.0
    bucket_counts: list[int] = field(default_factory=list)


class ObservabilityMetrics:
    """Small in-process Prometheus registry with a fixed, low-cardinality contract.

    A process-local registry is the normal Prometheus model: every application worker
    exposes its own counters and gauges, and the scraper aggregates them. Dynamic user,
    character, device and request identifiers are deliberately excluded from labels.
    """

    _DEFINITIONS = (
        _MetricDefinition(
            "daggerheart_build_info",
            "Static build information for this API process.",
            "gauge",
            ("version", "environment"),
        ),
        _MetricDefinition(
            "daggerheart_http_requests_total",
            "Completed HTTP requests grouped by method, route template and status class.",
            "counter",
            ("method", "route", "status_class"),
        ),
        _MetricDefinition(
            "daggerheart_http_request_duration_seconds",
            "HTTP request duration, including streaming response lifetime.",
            "histogram",
            ("method", "route"),
            _DEFAULT_HISTOGRAM_BUCKETS,
        ),
        _MetricDefinition(
            "daggerheart_api_errors_total",
            "Stable public API errors grouped by code and HTTP status.",
            "counter",
            ("code", "status"),
        ),
        _MetricDefinition(
            "daggerheart_payload_rejections_total",
            "Requests rejected by global or feature payload validation.",
            "counter",
            ("code",),
        ),
        _MetricDefinition(
            "daggerheart_csrf_failures_total",
            "Unsafe browser requests rejected by CSRF validation.",
            "counter",
            ("reason",),
        ),
        _MetricDefinition(
            "daggerheart_rate_limit_decisions_total",
            "Rate-limit decisions grouped by bounded policy and outcome.",
            "counter",
            ("policy", "outcome"),
        ),
        _MetricDefinition(
            "daggerheart_character_mutations_total",
            "Owner mutations grouped by result and idempotency/merge behavior.",
            "counter",
            ("outcome", "duplicate", "merged"),
        ),
        _MetricDefinition(
            "daggerheart_character_mutation_duration_seconds",
            "End-to-end owner mutation transaction duration.",
            "histogram",
            ("outcome",),
            _DEFAULT_HISTOGRAM_BUCKETS,
        ),
        _MetricDefinition(
            "daggerheart_character_write_retries_total",
            "Bounded PostgreSQL mutation retries grouped by stable reason.",
            "counter",
            ("reason",),
        ),
        _MetricDefinition(
            "daggerheart_character_write_busy_total",
            "Mutations rejected after concurrency retries were exhausted.",
            "counter",
        ),
        _MetricDefinition(
            "daggerheart_sse_connections_total",
            "Character SSE connections opened by access role.",
            "counter",
            ("role",),
        ),
        _MetricDefinition(
            "daggerheart_sse_connections_active",
            "Currently active character SSE connections by access role.",
            "gauge",
            ("role",),
        ),
        _MetricDefinition(
            "daggerheart_sse_connection_duration_seconds",
            "Lifetime of character SSE connections grouped by role and close reason.",
            "histogram",
            ("role", "reason"),
            _DEFAULT_HISTOGRAM_BUCKETS,
        ),
        _MetricDefinition(
            "daggerheart_sse_events_sent_total",
            "Persisted character events delivered over SSE.",
            "counter",
            ("role", "event_type"),
        ),
        _MetricDefinition(
            "daggerheart_sse_heartbeats_total",
            "Heartbeat frames delivered over SSE.",
            "counter",
            ("role",),
        ),
        _MetricDefinition(
            "daggerheart_sse_transport_failures_total",
            "SSE transport or database failures that force browser reconnection.",
            "counter",
            ("reason",),
        ),
        _MetricDefinition(
            "daggerheart_character_full_resync_total",
            "Full-resync instructions grouped by role and bounded reason.",
            "counter",
            ("role", "reason"),
        ),
        _MetricDefinition(
            "daggerheart_character_event_maintenance_rows_total",
            "Character event rows compacted or deleted by retention maintenance.",
            "counter",
            ("action",),
        ),
        _MetricDefinition(
            "daggerheart_character_event_maintenance_duration_seconds",
            "Duration of character event retention and compaction runs.",
            "histogram",
            (),
            _DEFAULT_HISTOGRAM_BUCKETS,
        ),
        _MetricDefinition(
            "daggerheart_audit_events_staged_total",
            "Audit rows staged in caller transactions, grouped by action and outcome.",
            "counter",
            ("action", "outcome"),
        ),
        _MetricDefinition(
            "daggerheart_data_lifecycle_rows_total",
            "Rows selected or deleted by privacy lifecycle maintenance.",
            "counter",
            ("resource", "action"),
        ),
        _MetricDefinition(
            "daggerheart_data_lifecycle_duration_seconds",
            "Duration of privacy lifecycle maintenance runs.",
            "histogram",
            ("mode",),
            _DEFAULT_HISTOGRAM_BUCKETS,
        ),
    )

    def __init__(self, *, version: str, environment: str, enabled: bool) -> None:
        self.enabled = enabled
        self._definitions = {definition.name: definition for definition in self._DEFINITIONS}
        self._values: dict[str, dict[tuple[str, ...], float]] = defaultdict(dict)
        self._histograms: dict[str, dict[tuple[str, ...], _HistogramValue]] = defaultdict(dict)
        self._lock = RLock()
        if enabled:
            self._set_gauge(
                "daggerheart_build_info",
                1.0,
                version=version,
                environment=environment,
            )

    def _label_tuple(
        self,
        definition: _MetricDefinition,
        labels: dict[str, str],
    ) -> tuple[str, ...]:
        if set(labels) != set(definition.labels):
            raise ValueError(f"labels do not match metric contract: {definition.name}")
        return tuple(str(labels[name])[:160] for name in definition.labels)

    def _inc(self, name: str, amount: float = 1.0, **labels: str) -> None:
        if not self.enabled:
            return
        definition = self._definitions[name]
        values = self._label_tuple(definition, labels)
        with self._lock:
            self._values[name][values] = self._values[name].get(values, 0.0) + amount

    def _set_gauge(self, name: str, value: float, **labels: str) -> None:
        if not self.enabled:
            return
        definition = self._definitions[name]
        values = self._label_tuple(definition, labels)
        with self._lock:
            self._values[name][values] = value

    def _add_gauge(self, name: str, amount: float, **labels: str) -> None:
        if not self.enabled:
            return
        definition = self._definitions[name]
        values = self._label_tuple(definition, labels)
        with self._lock:
            current = self._values[name].get(values, 0.0)
            self._values[name][values] = max(0.0, current + amount)

    def _observe(self, name: str, value: float, **labels: str) -> None:
        if not self.enabled:
            return
        definition = self._definitions[name]
        values = self._label_tuple(definition, labels)
        with self._lock:
            histogram = self._histograms[name].get(values)
            if histogram is None:
                histogram = _HistogramValue(bucket_counts=[0] * len(definition.buckets))
                self._histograms[name][values] = histogram
            histogram.count += 1
            histogram.total += max(0.0, value)
            for index, bucket in enumerate(definition.buckets):
                if value <= bucket:
                    histogram.bucket_counts[index] += 1

    def record_http_request(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        route_label = route if route.startswith("/") else "unmatched"
        status_class = f"{max(0, min(9, status_code // 100))}xx"
        method_label = method.upper()[:12]
        self._inc(
            "daggerheart_http_requests_total",
            method=method_label,
            route=route_label[:160],
            status_class=status_class,
        )
        self._observe(
            "daggerheart_http_request_duration_seconds",
            duration_seconds,
            method=method_label,
            route=route_label[:160],
        )

    def record_api_error(self, *, code: str, status_code: int) -> None:
        self._inc(
            "daggerheart_api_errors_total",
            code=code[:64],
            status=str(status_code),
        )

    def record_payload_rejection(self, *, code: str) -> None:
        self._inc("daggerheart_payload_rejections_total", code=code[:64])

    def record_csrf_failure(self, *, reason: str) -> None:
        self._inc("daggerheart_csrf_failures_total", reason=reason[:64])

    def record_rate_limit(self, *, policy: str, outcome: MetricOutcome) -> None:
        self._inc(
            "daggerheart_rate_limit_decisions_total",
            policy=policy[:64],
            outcome=outcome,
        )

    def record_character_mutation(
        self,
        *,
        outcome: str,
        duplicate: bool,
        merged: bool,
        duration_seconds: float,
    ) -> None:
        self._inc(
            "daggerheart_character_mutations_total",
            outcome=outcome[:32],
            duplicate=str(duplicate).lower(),
            merged=str(merged).lower(),
        )
        self._observe(
            "daggerheart_character_mutation_duration_seconds",
            duration_seconds,
            outcome=outcome[:32],
        )

    def record_character_write_retry(self, *, reason: str) -> None:
        self._inc("daggerheart_character_write_retries_total", reason=reason[:64])

    def record_character_write_busy(self) -> None:
        self._inc("daggerheart_character_write_busy_total")

    def record_sse_open(self, *, role: str) -> None:
        self._inc("daggerheart_sse_connections_total", role=role)
        self._add_gauge("daggerheart_sse_connections_active", 1, role=role)

    def record_sse_close(self, *, role: str, reason: str, duration_seconds: float) -> None:
        self._add_gauge("daggerheart_sse_connections_active", -1, role=role)
        self._observe(
            "daggerheart_sse_connection_duration_seconds",
            duration_seconds,
            role=role,
            reason=reason[:64],
        )

    def record_sse_event(self, *, role: str, event_type: str) -> None:
        self._inc(
            "daggerheart_sse_events_sent_total",
            role=role,
            event_type=event_type[:64],
        )

    def record_sse_heartbeat(self, *, role: str) -> None:
        self._inc("daggerheart_sse_heartbeats_total", role=role)

    def record_sse_transport_failure(self, *, reason: str) -> None:
        self._inc(
            "daggerheart_sse_transport_failures_total",
            reason=reason[:64],
        )

    def record_full_resync(self, *, role: str, reason: str) -> None:
        self._inc(
            "daggerheart_character_full_resync_total",
            role=role,
            reason=reason[:64],
        )

    def record_character_event_maintenance(
        self,
        *,
        compacted_count: int,
        deleted_count: int,
        duration_seconds: float,
    ) -> None:
        self._inc(
            "daggerheart_character_event_maintenance_rows_total",
            max(0, compacted_count),
            action="compacted",
        )
        self._inc(
            "daggerheart_character_event_maintenance_rows_total",
            max(0, deleted_count),
            action="deleted",
        )
        self._observe(
            "daggerheart_character_event_maintenance_duration_seconds",
            duration_seconds,
        )

    def record_audit_event(self, *, action: str, outcome: str) -> None:
        self._inc(
            "daggerheart_audit_events_staged_total",
            action=action[:80],
            outcome=outcome[:16],
        )

    def record_data_lifecycle_maintenance(
        self,
        *,
        counts: dict[str, int],
        dry_run: bool,
        duration_seconds: float,
    ) -> None:
        action = "selected" if dry_run else "deleted"
        for resource, count in counts.items():
            self._inc(
                "daggerheart_data_lifecycle_rows_total",
                max(0, count),
                resource=resource[:64],
                action=action,
            )
        self._observe(
            "daggerheart_data_lifecycle_duration_seconds",
            duration_seconds,
            mode="dry_run" if dry_run else "delete",
        )

    def render_prometheus(self) -> str:
        if not self.enabled:
            return ""
        lines: list[str] = []
        with self._lock:
            for definition in self._DEFINITIONS:
                lines.append(f"# HELP {definition.name} {definition.help}")
                lines.append(f"# TYPE {definition.name} {definition.metric_type}")
                if definition.metric_type == "histogram":
                    series = self._histograms.get(definition.name, {})
                    for labels, histogram in sorted(series.items()):
                        cumulative = 0
                        for bucket, count in zip(
                            definition.buckets,
                            histogram.bucket_counts,
                            strict=True,
                        ):
                            cumulative = count
                            bucket_names = definition.labels + ("le",)
                            bucket_values = labels + (_format_number(bucket),)
                            lines.append(
                                f"{definition.name}_bucket"
                                f"{_labels_text(bucket_names, bucket_values)} {cumulative}"
                            )
                        inf_names = definition.labels + ("le",)
                        inf_values = labels + ("+Inf",)
                        lines.append(
                            f"{definition.name}_bucket"
                            f"{_labels_text(inf_names, inf_values)} {histogram.count}"
                        )
                        lines.append(
                            f"{definition.name}_sum{_labels_text(definition.labels, labels)} "
                            f"{_format_number(histogram.total)}"
                        )
                        lines.append(
                            f"{definition.name}_count{_labels_text(definition.labels, labels)} "
                            f"{histogram.count}"
                        )
                    continue

                for labels, value in sorted(self._values.get(definition.name, {}).items()):
                    lines.append(
                        f"{definition.name}{_labels_text(definition.labels, labels)} "
                        f"{_format_number(value)}"
                    )
        return "\n".join(lines) + "\n"


_NOOP_METRICS = ObservabilityMetrics(version="unknown", environment="unknown", enabled=False)
_current_metrics: ContextVar[ObservabilityMetrics] = ContextVar(
    "daggerheart_observability_metrics",
    default=_NOOP_METRICS,
)


def set_current_metrics(metrics: ObservabilityMetrics) -> Token[ObservabilityMetrics]:
    return _current_metrics.set(metrics)


def reset_current_metrics(token: Token[ObservabilityMetrics]) -> None:
    _current_metrics.reset(token)


def get_current_metrics() -> ObservabilityMetrics:
    return _current_metrics.get()


def metrics_from_scope(scope: dict[str, Any]) -> ObservabilityMetrics:
    app = scope.get("app")
    if app is None:
        return _NOOP_METRICS
    return getattr(app.state, "metrics", _NOOP_METRICS)


def mark_scope_api_error(scope: dict[str, Any], *, code: str) -> None:
    scope.setdefault("state", {})["api_error_code"] = code


def _safe_log_value(value: Any, *, max_length: int, depth: int = 0) -> Any:
    if depth > 3:
        return "[truncated]"
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, str):
        normalized = " ".join(value.split())
        return normalized[:max_length]
    if isinstance(value, (list, tuple)):
        return [
            _safe_log_value(item, max_length=max_length, depth=depth + 1)
            for item in value[:32]
        ]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for raw_key, item in list(value.items())[:32]:
            key = str(raw_key)[:64]
            if any(part in key.lower() for part in _FORBIDDEN_LOG_FIELD_PARTS):
                result[key] = "[redacted]"
            else:
                result[key] = _safe_log_value(
                    item,
                    max_length=max_length,
                    depth=depth + 1,
                )
        return result
    return type(value).__name__


class JsonLogFormatter(logging.Formatter):
    def __init__(self, *, max_field_length: int, include_tracebacks: bool) -> None:
        super().__init__()
        self.max_field_length = max_field_length
        self.include_tracebacks = include_tracebacks

    def format(self, record: logging.LogRecord) -> str:
        event = getattr(record, "event", None)
        if not isinstance(event, str) or not _SAFE_EVENT_PATTERN.fullmatch(event):
            event = "application.log"
        payload: dict[str, Any] = {
            "timestamp": (
                datetime.now(UTC)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            ),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": event,
        }
        request_id = get_request_id()
        if request_id:
            payload["requestId"] = request_id

        fields = getattr(record, "structured_fields", None)
        if isinstance(fields, dict):
            payload.update(
                _safe_log_value(
                    fields,
                    max_length=self.max_field_length,
                )
            )

        if record.exc_info is not None:
            exception_type = record.exc_info[0]
            payload["exceptionType"] = exception_type.__name__ if exception_type else "Exception"
            if self.include_tracebacks:
                payload["traceback"] = self.formatException(record.exc_info)[
                    : self.max_field_length * 8
                ]
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def configure_structured_logging(
    *,
    enabled: bool,
    level: str,
    max_field_length: int,
    include_tracebacks: bool,
    disable_uvicorn_access_log: bool,
) -> None:
    if not enabled:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonLogFormatter(
            max_field_length=max_field_length,
            include_tracebacks=include_tracebacks,
        )
    )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper()))
    logging.captureWarnings(True)
    for noisy_logger in ("httpx", "httpcore", "asyncio", "sqlalchemy.engine"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)
    if disable_uvicorn_access_log:
        logging.getLogger("uvicorn.access").disabled = True


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    *,
    exc_info: bool = False,
    **fields: Any,
) -> None:
    safe_event = event if _SAFE_EVENT_PATTERN.fullmatch(event) else "application.log"
    logger.log(
        level,
        safe_event,
        extra={"event": safe_event, "structured_fields": fields},
        exc_info=True if exc_info else None,
    )


@dataclass(frozen=True, slots=True)
class Stopwatch:
    started_at: float

    @classmethod
    def start(cls) -> Stopwatch:
        return cls(perf_counter())

    def elapsed(self) -> float:
        return max(0.0, perf_counter() - self.started_at)
