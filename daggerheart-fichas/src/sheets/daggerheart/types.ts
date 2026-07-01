export type Language = "pt-BR" | "en-US";

export type Localized<T> = Record<Language, T>;
export type LocalizedString = Localized<string>;

export type DaggerheartClassKey =
  | "bard"
  | "druid"
  | "guardian"
  | "ranger"
  | "rogue"
  | "seraph"
  | "sorcerer"
  | "warrior"
  | "wizard";

export type TrackerKind = "slot" | "diamond" | "coin" | "number";

export type DaggerheartTrackerConfig = {
  name: string;
  label: LocalizedString;
  count: number;
  kind: TrackerKind;
};

export type DaggerheartClassFeature = {
  title: LocalizedString;
  spellcastTraitLabel?: LocalizedString;
  description: LocalizedString;
  tracker?: DaggerheartTrackerConfig;
};

export type DaggerheartHopeFeature = {
  title: LocalizedString;
  description: LocalizedString;
};

export type DaggerheartReferenceSection = {
  title: string;
  content: string;
};

export type DaggerheartNamedText = {
  title: LocalizedString;
  description: LocalizedString;
};

export type DaggerheartBeastformOption = {
  tier: 1 | 2 | 3 | 4;
  name: LocalizedString;
  examples: LocalizedString;
  traitAndEvasion: LocalizedString;
  attack: LocalizedString;
  advantages: Localized<string[]>;
  features: DaggerheartNamedText[];
};

export type DaggerheartCompanionTrainingOption = {
  key: string;
  title: LocalizedString;
  description: LocalizedString;
  slots?: number;
  hopeSlot?: boolean;
};

export type DaggerheartCompanionPage = {
  evasionStart: number;
  intro: LocalizedString;
  experienceDescription: LocalizedString;
  exampleExperiences: Localized<string[]>;
  commandDescription: LocalizedString;
  attackDescription: LocalizedString;
  stressDescription: LocalizedString;
  trainingIntro: LocalizedString;
  trainingOptions: DaggerheartCompanionTrainingOption[];
};

export type StartingInventory = {
  fixed: Localized<string[]>;
  choices: Localized<string[]>;
};

export type AppearanceSuggestion = {
  label: string;
  values: string[];
};

export type DaggerheartTraitDefinition = {
  key:
    | "agility"
    | "strength"
    | "finesse"
    | "instinct"
    | "presence"
    | "knowledge";
  label: LocalizedString;
  skills: Localized<string[]>;
};

export type DaggerheartClassDefinition = {
  key: DaggerheartClassKey;
  title: LocalizedString;
  domains: LocalizedString;
  defaultSubclass?: LocalizedString;
  evasionStart?: number;
  hopeFeature?: DaggerheartHopeFeature;

  suggestedTraits?: LocalizedString;
  suggestedPrimaryWeapon?: LocalizedString;
  suggestedSecondaryWeapon?: LocalizedString;
  suggestedArmor?: LocalizedString;

  startingInventory?: StartingInventory;

  classFeature: DaggerheartClassFeature;

  backgroundQuestions: Localized<string[]>;
  connectionQuestions: Localized<string[]>;

  appearanceSuggestions?: Localized<AppearanceSuggestion[]>;
  guideReferenceSections?: Localized<DaggerheartReferenceSection[]>;
  beastforms?: DaggerheartBeastformOption[];
  companion?: DaggerheartCompanionPage;

  startingExperiencePlaceholder?: LocalizedString;
};


export type DaggerheartDetailsPage = {
  physical: {
    age: string;
    height: string;
    weight: string;
    other: string;
    eyes: string;
    body: string;
    hair: string;
  };
  domainCards: string;
  abilities: {
    ancestry: {
      first: string;
      second: string;
    };
    community: string;
    foundation: {
      castingAttribute: string;
      text: string;
    };
    specialization: string;
    mastery: string;
  };
  story: string;
};

export type DaggerheartTexts = {
  invalidClassMessage: string;
  customSheetTitle: string;
  unsupportedSystemMessage: string;

  name: string;
  pronouns: string;
  heritage: string;
  subclass: string;
  level: string;

  traits: string;
  summary: string;
  evasion: string;
  startsAt9: string;
  armor: string;
  score: string;
  proficiency: string;
  dieLevel: string;
  activeArmor: string;
  currentUse: string;
  armorSlots: string;

  damageHealth: string;
  damageThresholdHint: string;
  minorDamage: string;
  majorDamage: string;
  severeDamage: string;
  marks1Hp: string;
  marks2Hp: string;
  marks3Hp: string;
  hp: string;
  stress: string;

  hope: string;
  hopeHint: string;
  lifeSupport: string;
  lifeSupportText: string;

  experiences: string;
  experience: string;
  bonus: string;

  gold: string;
  handfuls: string;
  bags: string;
  chest: string;

  classFeature: string;
  featureName: string;
  spellcastTrait: string;
  featureDescription: string;

  activeWeapons: string;
  primaryAndSecondary: string;
  primary: string;
  secondary: string;
  weaponName: string;
  traitRange: string;
  damageDieType: string;
  feature: string;

  activeArmorSection: string;
  baseThresholds: string;
  baseScore: string;

  inventory: string;
  inventoryPlaceholder: string;
  inventoryWeapon: string;
  inventoryPrimary: string;
  inventorySecondary: string;

  guideAndProgression: string;
  suggestions: string;
  suggestedTraits: string;
  suggestedPrimary: string;
  suggestedSecondary: string;
  suggestedArmor: string;
  startingInventory: string;
  take: string;
  chooseBetween: string;
  description: string;
  backgroundQuestions: string;
  connections: string;
  startingExperiences: string;

  chooseTwoOptions: string;
  notes: string;
  tabs: {
    sheetNavigation: string;
    sheet: string;
    details: string;
  };

  details: {
    physicalDetails: string;
    age: string;
    height: string;
    weight: string;
    other: string;
    eyes: string;
    body: string;
    hair: string;
    domainCards: string;
    domainCardsPlaceholder: string;
    abilities: string;
    ancestryAbilities: string;
    ancestryFirst: string;
    ancestrySecond: string;
    communityAbility: string;
    foundationAbility: string;
    castingAttribute: string;
    specializationAbility: string;
    masteryAbility: string;
    abilityPlaceholder: string;
    characterStory: string;
    characterStoryPlaceholder: string;
  };

  progression: {
    tiers: {
      key: "tier2" | "tier3" | "tier4";
      title: string;
      text: string;
      limit: number;
    }[];
    options: string[];
  };

  beastform: string;
  activeBeastform: string;
  chosenBeastform: string;
  beastformReference: string;
  tier: string;
  examples: string;
  traitAndEvasion: string;
  attack: string;
  gainAdvantageOn: string;
  specialFeatures: string;
  beastformNotes: string;

  companion: string;
  companionName: string;
  companionImageNotes: string;
  companionEvasion: string;
  companionExperience: string;
  exampleCompanionExperiences: string;
  attackAndDamage: string;
  standardAttack: string;
  range: string;
  training: string;
  companionStress: string;
  trainingMarks: string;
  hopeSlot: string;

  printNote: string;
};
