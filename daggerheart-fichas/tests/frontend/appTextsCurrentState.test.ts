import { describe, expect, it } from "vitest";
import { appTexts } from "../../src/i18n/appTexts";

describe("frontend copy matches the current cloud feature set", () => {
  it("keeps Portuguese and English translation contracts aligned", () => {
    expect(Object.keys(appTexts["pt-BR"]).sort()).toEqual(
      Object.keys(appTexts["en-US"]).sort()
    );
    expect(Object.keys(appTexts["pt-BR"].classes.daggerheart).sort()).toEqual(
      Object.keys(appTexts["en-US"].classes.daggerheart).sort()
    );
  });

  it("describes sync, read-only sharing, and manual backups as separate features", () => {
    const pt = appTexts["pt-BR"];
    const en = appTexts["en-US"];

    expect(pt.authLoginDescription).toContain("sincronizar fichas");
    expect(pt.authLoginDescription).toContain("compartilhar em modo leitura");
    expect(pt.authLoginDescription).toContain("backups manuais");
    expect(pt.cloudSignedInHelp).toContain("sync ativo");
    expect(pt.cloudSignedInHelp).toContain("Backups continuam manuais");

    expect(en.authLoginDescription).toContain("sync characters across devices");
    expect(en.authLoginDescription).toContain("share them in read-only mode");
    expect(en.authLoginDescription).toContain("manual backups");
    expect(en.cloudSignedInHelp).toContain("sync enabled");
    expect(en.cloudSignedInHelp).toContain("Backups remain manual");
  });

  it("does not advertise completed conflict features as future work", () => {
    expect(
      "characterConflictDraftUnsupported" in appTexts["pt-BR"]
    ).toBe(false);
    expect(
      "characterConflictDraftUnsupported" in appTexts["en-US"]
    ).toBe(false);
    expect(appTexts["pt-BR"].characterConflictStrategyDuplicate).toBe(
      "Duplicar versão local"
    );
    expect(appTexts["en-US"].characterConflictStrategyDuplicate).toBe(
      "Duplicate local version"
    );
  });

  it("makes local-only destructive actions explicit", () => {
    const pt = appTexts["pt-BR"];
    const en = appTexts["en-US"];

    expect(pt.deleteCharacter).toBe("Remover deste dispositivo");
    expect(pt.deleteDescription).toContain("da lista deste dispositivo");
    expect(pt.deleteDescription).toContain("não são apagados");
    expect(pt.clearDataWarning).toContain("ainda não sincronizadas");
    expect(pt.clearDataWarning).toContain("permanecem na conta");

    expect(en.deleteCharacter).toBe("Remove from this device");
    expect(en.deleteDescription).toContain("from this device's list");
    expect(en.deleteDescription).toContain("are not deleted");
    expect(en.clearDataWarning).toContain("have not synced yet");
    expect(en.clearDataWarning).toContain("remain in the account");
  });

  it("states that imported backups do not restore live cloud links", () => {
    expect(appTexts["pt-BR"].importDescription).toContain(
      "sem restaurar vínculos de sync"
    );
    expect(appTexts["pt-BR"].cloudRestoreReplaceWarning).toContain(
      "voltam como locais"
    );
    expect(appTexts["en-US"].importDescription).toContain(
      "without restoring sync links"
    );
    expect(appTexts["en-US"].cloudRestoreReplaceWarning).toContain(
      "return as local-only"
    );
  });
});
