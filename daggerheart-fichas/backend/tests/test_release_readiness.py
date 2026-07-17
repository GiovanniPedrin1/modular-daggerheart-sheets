from __future__ import annotations

import pytest

from app.commands.check_release_readiness import (
    ReadinessCheck,
    build_readiness_report,
    configuration_checks,
    expected_alembic_heads,
    resolve_alembic_config_path,
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


def test_alembic_config_is_found_from_backend_working_directory(tmp_path, monkeypatch) -> None:
    backend_root = tmp_path / "backend"
    backend_root.mkdir()
    config_path = backend_root / "alembic.ini"
    config_path.write_text("[alembic]\nscript_location = %(here)s/alembic\n")

    monkeypatch.delenv("ALEMBIC_CONFIG", raising=False)

    assert resolve_alembic_config_path(
        working_directory=backend_root,
        module_file=tmp_path / "site-packages" / "app" / "commands" / "command.py",
    ) == config_path.resolve()


def test_alembic_config_is_found_from_repository_root(tmp_path, monkeypatch) -> None:
    backend_root = tmp_path / "backend"
    backend_root.mkdir()
    config_path = backend_root / "alembic.ini"
    config_path.write_text("[alembic]\nscript_location = %(here)s/alembic\n")

    monkeypatch.delenv("ALEMBIC_CONFIG", raising=False)

    assert resolve_alembic_config_path(
        working_directory=tmp_path,
        module_file=tmp_path / "site-packages" / "app" / "commands" / "command.py",
    ) == config_path.resolve()


def test_alembic_config_honors_explicit_environment_path(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "deployment-alembic.ini"
    config_path.write_text("[alembic]\nscript_location = %(here)s/alembic\n")
    monkeypatch.setenv("ALEMBIC_CONFIG", str(config_path))

    assert resolve_alembic_config_path(
        working_directory=tmp_path / "other",
        module_file=tmp_path / "site-packages" / "app" / "commands" / "command.py",
    ) == config_path.resolve()


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
