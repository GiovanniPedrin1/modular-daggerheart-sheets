from app.api.backups import calculate_payload_checksum, stable_json_dumps
from app.schemas.backups import CloudBackupPayload


def make_local_payload():
    return {
        "app": "rpg-sheets-local-first",
        "formatVersion": 1,
        "exportedAt": "2026-07-02T00:00:00.000Z",
        "characters": [
            {
                "id": "char-1",
                "name": "Lyra",
                "system": "daggerheart",
                "language": "pt-BR",
                "data": {"level": "1", "class": "wizard"},
                "createdAt": "2026-07-02T00:00:00.000Z",
                "updatedAt": "2026-07-02T00:00:00.000Z",
                "version": 1,
                "syncStatus": "local",
            }
        ],
        "settings": [{"key": "language", "value": "pt-BR"}],
    }


def test_stable_json_dumps_sorts_nested_keys() -> None:
    assert stable_json_dumps({"b": 1, "a": {"d": 4, "c": 3}}) == '{"a":{"c":3,"d":4},"b":1}'


def test_cloud_backup_payload_accepts_valid_backup() -> None:
    payload = make_local_payload()
    checksum = calculate_payload_checksum(payload)

    parsed = CloudBackupPayload.model_validate(
        {
            "app": "daggerheart-fichas",
            "cloudFormatVersion": 1,
            "sourceAppVersion": "1.3.0-prep.5",
            "exportedAt": "2026-07-02T00:00:00.000Z",
            "deviceId": "device-1",
            "checksum": checksum,
            "payload": payload,
        }
    )

    assert parsed.checksum == checksum
    assert parsed.payload.characters[0]["name"] == "Lyra"
