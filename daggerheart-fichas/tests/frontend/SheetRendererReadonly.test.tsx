import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SheetRenderer } from "../../src/sheets/registry";

describe("SheetRenderer readOnly", () => {
  it("blocks controls and mutations while keeping sheet navigation available", async () => {
    const onSheetDataChange = vi.fn();
    const onSheetEditingStart = vi.fn();
    const onSheetEditingEnd = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <SheetRenderer
        character={{
          id: "shared-1",
          name: "Lyra",
          system: "daggerheart",
          class: "sorcerer",
          createdAt: "2026-07-09T12:00:00.000Z",
          data: { char_name: "Lyra" },
        }}
        language="pt-BR"
        readOnly
        onSheetDataChange={onSheetDataChange}
        onSheetEditingStart={onSheetEditingStart}
        onSheetEditingEnd={onSheetEditingEnd}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Modo leitura");

    const form = container.querySelector("form");
    expect(form).toHaveAttribute("aria-readonly", "true");

    const editableControls = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        ".dh-readonly-scope input, .dh-readonly-scope textarea, .dh-readonly-scope select"
      )
    );
    expect(editableControls.length).toBeGreaterThan(0);
    editableControls.forEach((control) => expect(control).toBeDisabled());

    fireEvent.input(editableControls[0], { target: { value: "Alterado" } });
    expect(onSheetDataChange).not.toHaveBeenCalled();
    expect(onSheetEditingStart).not.toHaveBeenCalled();
    expect(onSheetEditingEnd).not.toHaveBeenCalled();

    const detailsTab = screen.getByRole("button", { name: "Detalhes / História" });
    expect(detailsTab).toBeEnabled();
    await user.click(detailsTab);
    expect(detailsTab).toHaveAttribute("aria-current", "page");
  });

  it("shows a conflict-specific lock message and action without unlocking controls", async () => {
    const onReadOnlyAction = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <SheetRenderer
        character={{
          id: "owner-conflict-1",
          name: "Lyra",
          system: "daggerheart",
          class: "sorcerer",
          createdAt: "2026-07-15T12:00:00.000Z",
          data: { char_name: "Lyra" },
        }}
        language="pt-BR"
        readOnly
        readOnlyTitle="Edição bloqueada por conflito"
        readOnlyDescription="Resolva o conflito antes de continuar editando."
        readOnlyActionLabel="Resolver conflito"
        onReadOnlyAction={onReadOnlyAction}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Edição bloqueada por conflito"
    );

    const action = screen.getByRole("button", { name: "Resolver conflito" });
    await user.click(action);
    expect(onReadOnlyAction).toHaveBeenCalledOnce();

    const nameInput = container.querySelector<HTMLInputElement>("#char_name");
    expect(nameInput).toBeDisabled();
  });
});
