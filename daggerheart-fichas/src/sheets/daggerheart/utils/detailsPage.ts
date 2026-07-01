import type { DaggerheartDetailsPage } from "../types";

export const DEFAULT_DETAILS_PAGE: DaggerheartDetailsPage = {
  physical: {
    age: "",
    height: "",
    weight: "",
    other: "",
    eyes: "",
    body: "",
    hair: "",
  },
  domainCards: "",
  abilities: {
    ancestry: {
      first: "",
      second: "",
    },
    community: "",
    foundation: {
      castingAttribute: "",
      text: "",
    },
    specialization: "",
    mastery: "",
  },
  story: "",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrDefault(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function normalizeDetailsPage(value?: unknown): DaggerheartDetailsPage {
  const details = isPlainObject(value) ? value : {};
  const physical = isPlainObject(details.physical) ? details.physical : {};
  const abilities = isPlainObject(details.abilities) ? details.abilities : {};
  const ancestry = isPlainObject(abilities.ancestry) ? abilities.ancestry : {};
  const foundation = isPlainObject(abilities.foundation)
    ? abilities.foundation
    : {};

  return {
    physical: {
      age: stringOrDefault(physical.age),
      height: stringOrDefault(physical.height),
      weight: stringOrDefault(physical.weight),
      other: stringOrDefault(physical.other),
      eyes: stringOrDefault(physical.eyes),
      body: stringOrDefault(physical.body),
      hair: stringOrDefault(physical.hair),
    },
    domainCards: stringOrDefault(details.domainCards),
    abilities: {
      ancestry: {
        first: stringOrDefault(ancestry.first),
        second: stringOrDefault(ancestry.second),
      },
      community: stringOrDefault(abilities.community),
      foundation: {
        castingAttribute: stringOrDefault(foundation.castingAttribute),
        text: stringOrDefault(foundation.text),
      },
      specialization: stringOrDefault(abilities.specialization),
      mastery: stringOrDefault(abilities.mastery),
    },
    story: stringOrDefault(details.story),
  };
}
