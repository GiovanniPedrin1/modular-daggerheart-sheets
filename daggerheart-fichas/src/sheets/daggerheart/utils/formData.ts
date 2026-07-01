export type SheetFieldValue = string | boolean;

export type SerializedSheetData = {
  fields: Record<string, SheetFieldValue>;
};

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
