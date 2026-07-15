import type { CharacterRecord } from "../db/localDb";
import { daggerheartClasses, traitData } from "../sheets/daggerheart/data/shared";
import { daggerheartTexts } from "../sheets/daggerheart/i18n";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import { localize } from "../sheets/daggerheart/utils/localize";
import type { CloudCharacter } from "../types/cloudCharacter";
import type { CharacterConflictResolutionContext } from "./characterConflictReadService";
import {
  characterMutationPathsIntersect,
  normalizeCharacterMutationPath,
  parseCharacterMutationPath,
} from "./characterMutationPathService";

export const CHARACTER_CONFLICT_PATH_CLASSIFICATIONS = [
  "simple",
  "complex",
] as const;

export type CharacterConflictPathClassification =
  (typeof CHARACTER_CONFLICT_PATH_CLASSIFICATIONS)[number];

export const CHARACTER_CONFLICT_COMPLEXITY_REASONS = [
  "structured-value",
  "hierarchical-overlap",
] as const;

export type CharacterConflictComplexityReason =
  (typeof CHARACTER_CONFLICT_COMPLEXITY_REASONS)[number];

export const CHARACTER_CONFLICT_VALUE_KINDS = [
  "missing",
  "empty",
  "null",
  "boolean",
  "number",
  "text",
  "structured",
] as const;

export type CharacterConflictValueKind =
  (typeof CHARACTER_CONFLICT_VALUE_KINDS)[number];

export type CharacterConflictSectionKey =
  | "character"
  | "identity"
  | "traits"
  | "summary"
  | "health"
  | "hope"
  | "experiences"
  | "gold"
  | "classFeature"
  | "weapons"
  | "armor"
  | "inventory"
  | "details"
  | "progression"
  | "classExtras"
  | "other";

export type CharacterMutationPathDescription = {
  path: string;
  segments: readonly string[];
  sectionKey: CharacterConflictSectionKey;
  sectionLabel: string;
  label: string;
};

export type CharacterConflictPresentedValue = {
  exists: boolean;
  kind: CharacterConflictValueKind;
  raw: unknown;
  display: string;
  multiline: boolean;
};

export type CharacterConflictPathPresentation =
  CharacterMutationPathDescription & {
    classification: CharacterConflictPathClassification;
    complexityReasons: CharacterConflictComplexityReason[];
    intersectingRemotePaths: string[];
    local: CharacterConflictPresentedValue;
    remote: CharacterConflictPresentedValue;
  };

export type CharacterConflictPathGroup = {
  key: CharacterConflictSectionKey;
  label: string;
  paths: CharacterConflictPathPresentation[];
};

export type CharacterConflictPresentation = {
  language: Language;
  paths: CharacterConflictPathPresentation[];
  groups: CharacterConflictPathGroup[];
  simpleCount: number;
  complexCount: number;
  hasComplexPaths: boolean;
};

type PathValue = {
  exists: boolean;
  value: unknown;
};

type FieldDescriptor = {
  sectionKey: CharacterConflictSectionKey;
  label: string;
};

type PresentationTexts = {
  sections: Record<CharacterConflictSectionKey, string>;
  metadata: {
    system: string;
    characterClass: string;
    language: string;
  };
  values: {
    missing: string;
    empty: string;
    yes: string;
    no: string;
    customSystem: string;
    portugueseBrazil: string;
    englishUnitedStates: string;
  };
  field: {
    marked: string;
    slot: string;
    maximum: string;
    question: string;
    option: string;
  };
};

const presentationTexts: Record<Language, PresentationTexts> = {
  "pt-BR": {
    sections: {
      character: "Ficha",
      identity: "Identidade",
      traits: "Traços",
      summary: "Resumo",
      health: "Dano e saúde",
      hope: "Esperança",
      experiences: "Experiências",
      gold: "Ouro",
      classFeature: "Feature da classe",
      weapons: "Armas",
      armor: "Armadura",
      inventory: "Inventário",
      details: "Detalhes",
      progression: "Progressão",
      classExtras: "Extras da classe",
      other: "Outros campos",
    },
    metadata: {
      system: "Sistema",
      characterClass: "Classe",
      language: "Idioma",
    },
    values: {
      missing: "Não definido",
      empty: "Vazio",
      yes: "Sim",
      no: "Não",
      customSystem: "Personalizado",
      portugueseBrazil: "Português (Brasil)",
      englishUnitedStates: "Inglês (Estados Unidos)",
    },
    field: {
      marked: "Marcado",
      slot: "Marca",
      maximum: "Máximo",
      question: "Pergunta",
      option: "Opção",
    },
  },
  "en-US": {
    sections: {
      character: "Character",
      identity: "Identity",
      traits: "Traits",
      summary: "Summary",
      health: "Damage and health",
      hope: "Hope",
      experiences: "Experiences",
      gold: "Gold",
      classFeature: "Class feature",
      weapons: "Weapons",
      armor: "Armor",
      inventory: "Inventory",
      details: "Details",
      progression: "Progression",
      classExtras: "Class extras",
      other: "Other fields",
    },
    metadata: {
      system: "System",
      characterClass: "Class",
      language: "Language",
    },
    values: {
      missing: "Not set",
      empty: "Empty",
      yes: "Yes",
      no: "No",
      customSystem: "Custom",
      portugueseBrazil: "Portuguese (Brazil)",
      englishUnitedStates: "English (United States)",
    },
    field: {
      marked: "Marked",
      slot: "Mark",
      maximum: "Maximum",
      question: "Question",
      option: "Option",
    },
  },
};

const SECTION_ORDER: readonly CharacterConflictSectionKey[] = [
  "character",
  "identity",
  "traits",
  "summary",
  "health",
  "hope",
  "experiences",
  "gold",
  "classFeature",
  "weapons",
  "armor",
  "inventory",
  "details",
  "progression",
  "classExtras",
  "other",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function capitalize(value: string, language: Language): string {
  if (!value) return value;
  return `${value.charAt(0).toLocaleUpperCase(language)}${value.slice(1)}`;
}

function humanizeIdentifier(value: string, language: Language): string {
  const normalized = value
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return capitalize(normalized || value, language);
}

function describeDetailsPath(
  fieldPath: string,
  language: Language,
): FieldDescriptor | null {
  const t = daggerheartTexts[language];
  const labels: Record<string, string> = {
    "detailsPage.physical.age": t.details.age,
    "detailsPage.physical.height": t.details.height,
    "detailsPage.physical.weight": t.details.weight,
    "detailsPage.physical.other": t.details.other,
    "detailsPage.physical.eyes": t.details.eyes,
    "detailsPage.physical.body": t.details.body,
    "detailsPage.physical.hair": t.details.hair,
    "detailsPage.domainCards": t.details.domainCards,
    "detailsPage.abilities.ancestry.first": `${t.details.ancestryAbilities} — ${t.details.ancestryFirst}`,
    "detailsPage.abilities.ancestry.second": `${t.details.ancestryAbilities} — ${t.details.ancestrySecond}`,
    "detailsPage.abilities.community": t.details.communityAbility,
    "detailsPage.abilities.foundation.castingAttribute": `${t.details.foundationAbility} — ${t.details.castingAttribute}`,
    "detailsPage.abilities.foundation.text": `${t.details.foundationAbility} — ${t.details.foundationDescription}`,
    "detailsPage.abilities.specialization": t.details.specializationAbility,
    "detailsPage.abilities.mastery": t.details.masteryAbility,
    "detailsPage.story": t.details.characterStory,
  };

  if (labels[fieldPath]) {
    return { sectionKey: "details", label: labels[fieldPath] };
  }

  if (fieldPath === "detailsPage") {
    return { sectionKey: "details", label: t.tabs.details };
  }

  if (fieldPath.startsWith("detailsPage.")) {
    const breadcrumb = fieldPath
      .slice("detailsPage.".length)
      .split(".")
      .map((segment) => humanizeIdentifier(segment, language))
      .join(" › ");
    return { sectionKey: "details", label: breadcrumb };
  }

  return null;
}

function describeKnownFlatField(
  fieldName: string,
  language: Language,
): FieldDescriptor | null {
  const t = daggerheartTexts[language];
  const fixed: Record<string, FieldDescriptor> = {
    char_name: { sectionKey: "identity", label: t.name },
    pronouns: { sectionKey: "identity", label: t.pronouns },
    heritage: { sectionKey: "identity", label: t.heritage },
    subclass: { sectionKey: "identity", label: t.subclass },
    level: { sectionKey: "identity", label: t.level },
    evasion: { sectionKey: "summary", label: t.evasion },
    armor_score: { sectionKey: "summary", label: `${t.armor} — ${t.score}` },
    proficiency: { sectionKey: "summary", label: t.proficiency },
    armor_active: { sectionKey: "summary", label: t.activeArmor },
    minor_threshold: { sectionKey: "health", label: t.minorDamage },
    major_threshold: { sectionKey: "health", label: t.majorDamage },
    severe_threshold: { sectionKey: "health", label: t.severeDamage },
    hp_max: {
      sectionKey: "health",
      label: `${t.hp} — ${presentationTexts[language].field.maximum}`,
    },
    stress_max: {
      sectionKey: "health",
      label: `${t.stress} — ${presentationTexts[language].field.maximum}`,
    },
    life_support: { sectionKey: "hope", label: t.lifeSupport },
    starting_experiences: {
      sectionKey: "experiences",
      label: t.startingExperiences,
    },
    gold_chest: { sectionKey: "gold", label: t.chest },
    feature_title: { sectionKey: "classFeature", label: t.featureName },
    spellcast_trait: { sectionKey: "classFeature", label: t.spellcastTrait },
    feature_text: { sectionKey: "classFeature", label: t.featureDescription },
    active_armor_name: { sectionKey: "armor", label: t.name },
    active_armor_thresholds: { sectionKey: "armor", label: t.baseThresholds },
    active_armor_score: { sectionKey: "armor", label: t.baseScore },
    active_armor_feature: { sectionKey: "armor", label: t.feature },
    inventory: { sectionKey: "inventory", label: t.inventory },
    beastform_current_name: {
      sectionKey: "classExtras",
      label: `${t.beastform} — ${t.chosenBeastform}`,
    },
    beastform_current_trait: {
      sectionKey: "classExtras",
      label: `${t.beastform} — ${t.traitAndEvasion}`,
    },
    beastform_current_attack: {
      sectionKey: "classExtras",
      label: `${t.beastform} — ${t.attack}`,
    },
    beastform_current_advantages: {
      sectionKey: "classExtras",
      label: `${t.beastform} — ${t.gainAdvantageOn}`,
    },
    beastform_current_notes: {
      sectionKey: "classExtras",
      label: `${t.beastform} — ${t.beastformNotes}`,
    },
    companion_name: { sectionKey: "classExtras", label: t.companionName },
    companion_evasion: { sectionKey: "classExtras", label: t.companionEvasion },
    companion_image_notes: {
      sectionKey: "classExtras",
      label: t.companionImageNotes,
    },
    companion_standard_attack: {
      sectionKey: "classExtras",
      label: t.standardAttack,
    },
    companion_range: { sectionKey: "classExtras", label: t.range },
    companion_damage_die: {
      sectionKey: "classExtras",
      label: t.damageDieType,
    },
  };

  if (fixed[fieldName]) return fixed[fieldName];

  const traitMatch = /^trait_(agility|strength|finesse|instinct|presence|knowledge)(?:_(marked))?$/u.exec(
    fieldName,
  );
  if (traitMatch) {
    const trait = traitData.find((item) => item.key === traitMatch[1]);
    const baseLabel = trait
      ? localize(trait.label, language)
      : humanizeIdentifier(traitMatch[1], language);
    return {
      sectionKey: "traits",
      label: traitMatch[2]
        ? `${baseLabel} — ${presentationTexts[language].field.marked}`
        : baseLabel,
    };
  }

  const trackerMatch = /^(hp|stress|hope|armor_slots|gold_handfuls|gold_bags|companion_stress)_(\d+)$/u.exec(
    fieldName,
  );
  if (trackerMatch) {
    const trackerDescriptors: Record<
      string,
      { sectionKey: CharacterConflictSectionKey; label: string }
    > = {
      hp: { sectionKey: "health", label: t.hp },
      stress: { sectionKey: "health", label: t.stress },
      hope: { sectionKey: "hope", label: t.hope },
      armor_slots: { sectionKey: "summary", label: t.armorSlots },
      gold_handfuls: { sectionKey: "gold", label: t.handfuls },
      gold_bags: { sectionKey: "gold", label: t.bags },
      companion_stress: { sectionKey: "classExtras", label: t.companionStress },
    };
    const descriptor = trackerDescriptors[trackerMatch[1]];
    return {
      sectionKey: descriptor.sectionKey,
      label: `${descriptor.label} — ${presentationTexts[language].field.slot} ${trackerMatch[2]}`,
    };
  }

  const experienceMatch = /^(companion_)?experience_(\d+)(?:_(bonus))?$/u.exec(
    fieldName,
  );
  if (experienceMatch) {
    const isCompanion = Boolean(experienceMatch[1]);
    const baseLabel = isCompanion ? t.companionExperience : t.experience;
    return {
      sectionKey: isCompanion ? "classExtras" : "experiences",
      label: experienceMatch[3]
        ? `${baseLabel} ${experienceMatch[2]} — ${t.bonus}`
        : `${baseLabel} ${experienceMatch[2]}`,
    };
  }

  const guideQuestionMatch = /^(bg_q|conn_q)(\d+)$/u.exec(fieldName);
  if (guideQuestionMatch) {
    const groupLabel =
      guideQuestionMatch[1] === "bg_q" ? t.backgroundQuestions : t.connections;
    return {
      sectionKey: "experiences",
      label: `${groupLabel} — ${presentationTexts[language].field.question} ${guideQuestionMatch[2]}`,
    };
  }

  const weaponMatch = /^(primary|secondary)_(name|trait_range|damage|primary|secondary|feature)$/u.exec(
    fieldName,
  );
  if (weaponMatch) {
    const weaponLabel = weaponMatch[1] === "primary" ? t.primary : t.secondary;
    const valueLabels: Record<string, string> = {
      name: t.weaponName,
      trait_range: t.traitRange,
      damage: t.damageDieType,
      primary: t.primary,
      secondary: t.secondary,
      feature: t.feature,
    };
    return {
      sectionKey: "weapons",
      label: `${weaponLabel} — ${valueLabels[weaponMatch[2]]}`,
    };
  }

  const tierNotesMatch = /^(tier[234])_notes$/u.exec(fieldName);
  if (tierNotesMatch) {
    const tier = t.progression.tiers.find((item) => item.key === tierNotesMatch[1]);
    return {
      sectionKey: "progression",
      label: `${tier?.title ?? humanizeIdentifier(tierNotesMatch[1], language)} — ${t.notes}`,
    };
  }

  const progressionMatch = /^(tier[234])_option_(\d+)(?:_(\d+))?$/u.exec(
    fieldName,
  );
  if (progressionMatch) {
    const tier = t.progression.tiers.find((item) => item.key === progressionMatch[1]);
    const optionIndex = Number.parseInt(progressionMatch[2], 10) - 1;
    const optionLabel =
      t.progression.options[optionIndex] ??
      `${presentationTexts[language].field.option} ${progressionMatch[2]}`;
    const boxSuffix = progressionMatch[3]
      ? ` — ${presentationTexts[language].field.slot} ${progressionMatch[3]}`
      : "";
    return {
      sectionKey: "progression",
      label: `${tier?.title ?? humanizeIdentifier(progressionMatch[1], language)} — ${optionLabel}${boxSuffix}`,
    };
  }

  const companionTrainingMatch = /^companion_training_(.+)_(\d+|hope)$/u.exec(
    fieldName,
  );
  if (companionTrainingMatch) {
    const suffix =
      companionTrainingMatch[2] === "hope"
        ? t.hopeSlot
        : `${presentationTexts[language].field.slot} ${companionTrainingMatch[2]}`;
    return {
      sectionKey: "classExtras",
      label: `${t.training} — ${humanizeIdentifier(companionTrainingMatch[1], language)} — ${suffix}`,
    };
  }

  if (fieldName.startsWith("beastform_ref_")) {
    return {
      sectionKey: "classExtras",
      label: `${t.beastformReference} — ${humanizeIdentifier(fieldName.slice("beastform_ref_".length), language)}`,
    };
  }

  for (const definition of Object.values(daggerheartClasses)) {
    if (definition.classFeature.tracker?.name === fieldName) {
      return {
        sectionKey: "classFeature",
        label: localize(definition.classFeature.tracker.label, language),
      };
    }
  }

  return null;
}

export function describeCharacterMutationPath(
  path: string,
  language: Language,
): CharacterMutationPathDescription {
  const normalizedPath = normalizeCharacterMutationPath(path);
  const segments = parseCharacterMutationPath(normalizedPath);
  const t = daggerheartTexts[language];
  const text = presentationTexts[language];
  let descriptor: FieldDescriptor;

  if (segments[0] !== "data") {
    const metadataLabels: Record<string, string> = {
      name: t.name,
      system: text.metadata.system,
      classKey: text.metadata.characterClass,
      language: text.metadata.language,
    };
    descriptor = {
      sectionKey: "character",
      label: metadataLabels[segments[0]] ?? humanizeIdentifier(segments[0], language),
    };
  } else {
    const fieldSegments = segments.slice(1);
    const fieldPath = fieldSegments.join(".");
    descriptor =
      describeDetailsPath(fieldPath, language) ??
      (fieldSegments.length === 1
        ? describeKnownFlatField(fieldSegments[0], language)
        : null) ?? {
        sectionKey: "other",
        label: fieldSegments
          .map((segment) => humanizeIdentifier(segment, language))
          .join(" › "),
      };
  }

  return {
    path: normalizedPath,
    segments,
    sectionKey: descriptor.sectionKey,
    sectionLabel: text.sections[descriptor.sectionKey],
    label: descriptor.label,
  };
}

function toLocalSnapshotRoot(character: CharacterRecord): Record<string, unknown> {
  return {
    name: character.name,
    system: character.system,
    classKey: character.class ?? null,
    language: character.language,
    data: character.data,
  };
}

function toRemoteSnapshotRoot(character: CloudCharacter): Record<string, unknown> {
  return {
    name: character.name,
    system: character.system,
    classKey: character.classKey ?? null,
    language: character.language,
    data: character.data,
  };
}

function readPathValue(root: Record<string, unknown>, path: string): PathValue {
  const segments = parseCharacterMutationPath(path);
  let current: unknown = root;

  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }

  return { exists: true, value: current };
}

function formatMetadataValue(
  path: string,
  value: unknown,
  language: Language,
): string | null {
  const text = presentationTexts[language];

  if (path === "/system") {
    if (value === "daggerheart") return "Daggerheart";
    if (value === "custom") return text.values.customSystem;
  }

  if (path === "/language") {
    if (value === "pt-BR") return text.values.portugueseBrazil;
    if (value === "en-US") return text.values.englishUnitedStates;
  }

  if (path === "/classKey" && typeof value === "string") {
    const definition = daggerheartClasses[value as DaggerheartClassKey];
    if (definition) return localize(definition.title, language);
  }

  return null;
}

export function formatCharacterConflictValue(
  input: PathValue,
  options: { path: string; language: Language },
): CharacterConflictPresentedValue {
  const { language, path } = options;
  const text = presentationTexts[language];

  if (!input.exists) {
    return {
      exists: false,
      kind: "missing",
      raw: undefined,
      display: text.values.missing,
      multiline: false,
    };
  }

  const value = input.value;
  const metadataDisplay = formatMetadataValue(path, value, language);

  if (metadataDisplay !== null) {
    return {
      exists: true,
      kind: "text",
      raw: cloneJson(value),
      display: metadataDisplay,
      multiline: false,
    };
  }

  if (value === null) {
    return {
      exists: true,
      kind: "null",
      raw: null,
      display: text.values.missing,
      multiline: false,
    };
  }

  if (typeof value === "boolean") {
    return {
      exists: true,
      kind: "boolean",
      raw: value,
      display: value ? text.values.yes : text.values.no,
      multiline: false,
    };
  }

  if (typeof value === "number") {
    return {
      exists: true,
      kind: "number",
      raw: value,
      display: new Intl.NumberFormat(language).format(value),
      multiline: false,
    };
  }

  if (typeof value === "string") {
    return {
      exists: true,
      kind: value.length === 0 ? "empty" : "text",
      raw: value,
      display: value.length === 0 ? text.values.empty : value,
      multiline: value.includes("\n"),
    };
  }

  return {
    exists: true,
    kind: "structured",
    raw: cloneJson(value),
    display: JSON.stringify(value, null, 2),
    multiline: true,
  };
}

export function buildCharacterConflictPathPresentation(input: {
  path: string;
  serverChangedPaths: readonly string[];
  localCharacter: CharacterRecord;
  remoteCharacter: CloudCharacter;
  language?: Language;
}): CharacterConflictPathPresentation {
  const language = input.language ?? input.localCharacter.language;
  const description = describeCharacterMutationPath(input.path, language);
  const localPathValue = readPathValue(
    toLocalSnapshotRoot(input.localCharacter),
    description.path,
  );
  const remotePathValue = readPathValue(
    toRemoteSnapshotRoot(input.remoteCharacter),
    description.path,
  );
  const local = formatCharacterConflictValue(localPathValue, {
    path: description.path,
    language,
  });
  const remote = formatCharacterConflictValue(remotePathValue, {
    path: description.path,
    language,
  });
  const intersectingRemotePaths = input.serverChangedPaths
    .map(normalizeCharacterMutationPath)
    .filter((remotePath) =>
      characterMutationPathsIntersect(description.path, remotePath),
    );
  const complexityReasons: CharacterConflictComplexityReason[] = [];

  if (local.kind === "structured" || remote.kind === "structured") {
    complexityReasons.push("structured-value");
  }

  if (intersectingRemotePaths.some((remotePath) => remotePath !== description.path)) {
    complexityReasons.push("hierarchical-overlap");
  }

  return {
    ...description,
    classification: complexityReasons.length > 0 ? "complex" : "simple",
    complexityReasons,
    intersectingRemotePaths,
    local,
    remote,
  };
}

export function presentCharacterConflictPaths(
  context: CharacterConflictResolutionContext,
  language: Language = context.character.language,
  presentedPaths: readonly string[] = context.conflictDetail.conflictingPaths,
): CharacterConflictPresentation {
  const paths = presentedPaths.map((path) =>
    buildCharacterConflictPathPresentation({
      path,
      serverChangedPaths: context.conflictDetail.serverChangedPaths,
      localCharacter: context.character,
      remoteCharacter: context.conflictDetail.serverCharacter,
      language,
    }),
  );
  const groupsByKey = new Map<
    CharacterConflictSectionKey,
    CharacterConflictPathPresentation[]
  >();

  for (const path of paths) {
    const group = groupsByKey.get(path.sectionKey) ?? [];
    group.push(path);
    groupsByKey.set(path.sectionKey, group);
  }

  const groups = SECTION_ORDER.flatMap((key): CharacterConflictPathGroup[] => {
    const groupedPaths = groupsByKey.get(key);
    if (!groupedPaths?.length) return [];
    return [
      {
        key,
        label: presentationTexts[language].sections[key],
        paths: groupedPaths,
      },
    ];
  });
  const simpleCount = paths.filter((path) => path.classification === "simple").length;
  const complexCount = paths.length - simpleCount;

  return {
    language,
    paths,
    groups,
    simpleCount,
    complexCount,
    hasComplexPaths: complexCount > 0,
  };
}
