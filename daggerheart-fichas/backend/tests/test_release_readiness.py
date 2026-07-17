from __future__ import annotations

import pytest

from app.commands.check_release_readiness import (
    ReadinessCheck,
    build_readiness_report,
    configuration_checks,
    expected_alembic_heads,
)
from app.core.config import Settings

pytestmark = pytest.mark.security


def test_configuration_checks_surface_paused_rollout_switches() -> None:
    settings = Settings(
        app_env="test",
        cloud_mutations_enabled=False,
        character_sse_enabled=False,
    )

    checks = {check.name: check for check in configuration_checks(settings)}

    assert checks["configuration"].status == "pass"
    assert checks["rollout.cloud_mutations"].status == "warning"
    assert checks["rollout.character_sse"].status == "warning"
    assert checks["deployment_environment"].status == "warning"


def test_alembic_head_is_discoverable() -> None:
    heads = expected_alembic_heads()
    assert heads == ("202607090009",)


@pytest.mark.asyncio
async def test_offline_readiness_report_skips_external_dependencies() -> None:
    settings = Settings(app_env="test", release_revision="test-revision")

    report = await build_readiness_report(
        settings,
        check_database=False,
        check_rate_limit=False,
    )

    assert report.ready is True
    assert report.release_revision == "test-revision"
    assert ReadinessCheck("database", "skipped", "disabled by command option") in report.checks
