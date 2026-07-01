import type { DaggerheartDetailsPage } from "../types";
import { normalizeDetailsPage } from "./detailsPage";

export type SheetFieldValue = string | boolean;
export type SheetFormFields = Record<string, SheetFieldValue>;

export type DaggerheartCharacterData = Record<
  string,
  SheetFieldValue | DaggerheartDetailsPage | undefined
> & {
  detailsPage?: DaggerheartDetailsPage;
};

export type SerializedSheetData = {
  fields: SheetFormFields;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSheetFieldValue(value: unknown): value is SheetFieldValue {
  return typeof value === "string" || typeof value === "boolean";
}

export function extractSheetFields(data?: unknown): SheetFormFields {
  if (!isPlainObject(data)) {
    return {};
  }

  const fields: SheetFormFields = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "detailsPage") continue;

    if (isSheetFieldValue(value)) {
      fields[key] = value;
    }
  }

  return fields;
}

export function normalizeDaggerheartCharacterData(
  data: unknown,
  options: { includeEmptyDetailsPage?: boolean } = {}
): DaggerheartCharacterData {
  const fields = extractSheetFields(data);
  const normalized: DaggerheartCharacterData = { ...fields };

  if (
    options.includeEmptyDetailsPage ||
    (isPlainObject(data) && Object.prototype.hasOwnProperty.call(data, "detailsPage"))
  ) {
    normalized.detailsPage = normalizeDetailsPage(
      isPlainObject(data) ? data.detailsPage : undefined
    );
  }

  return normalized;
}

export function mergeSheetFieldsIntoDaggerheartData(
  currentData: unknown,
  nextFields: SheetFormFields
): DaggerheartCharacterData {
  const nextData: DaggerheartCharacterData = { ...nextFields };

  if (
    isPlainObject(currentData) &&
    Object.prototype.hasOwnProperty.call(currentData, "detailsPage")
  ) {
    nextData.detailsPage = normalizeDetailsPage(currentData.detailsPage);
  }

  return nextData;
}

function getSheetFields(form: HTMLFormElement) {
  return Array.from(
    form.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]")
  );
}

export function serializeSheetForm(form: HTMLFormElement): SerializedSheetData {
  const fields: SerializedSheetData["fields"] = {};

  for (const field of getSheetFields(form)) {
    if (field instanceof HTMLInputElement) {
      if (field.type === "checkbox") {
        fields[field.name] = field.checked;
        continue;
      }

      if (field.type === "radio") {
        if (field.checked) {
          fields[field.name] = field.value;
        } else if (!Object.prototype.hasOwnProperty.call(fields, field.name)) {
          fields[field.name] = "";
        }
        continue;
      }
    }

    fields[field.name] = field.value;
  }

  return { fields };
}

export function hydrateSheetForm(
  form: HTMLFormElement,
  data: SerializedSheetData
) {
  for (const field of getSheetFields(form)) {
    if (!Object.prototype.hasOwnProperty.call(data.fields, field.name)) {
      continue;
    }

    const value = data.fields[field.name];

    if (field instanceof HTMLInputElement) {
      if (field.type === "checkbox") {
        field.checked = Boolean(value);
        continue;
      }

      if (field.type === "radio") {
        field.checked = String(value) === field.value;
        continue;
      }
    }

    field.value = String(value ?? "");
  }
}
