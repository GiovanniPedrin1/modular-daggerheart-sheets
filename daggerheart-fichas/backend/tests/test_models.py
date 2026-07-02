from app.db.base import Base
from app.models import CloudBackup, RefreshSession, User


def test_auth_and_backup_tables_are_registered() -> None:
    assert User.__tablename__ in Base.metadata.tables
    assert RefreshSession.__tablename__ in Base.metadata.tables
    assert CloudBackup.__tablename__ in Base.metadata.tables


def test_cloud_backup_payload_uses_jsonb() -> None:
    payload_column = CloudBackup.__table__.c.payload
    assert payload_column.type.__class__.__name__ == "JSONB"
