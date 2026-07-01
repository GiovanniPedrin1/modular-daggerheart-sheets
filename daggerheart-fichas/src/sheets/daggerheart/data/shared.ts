import type {
  DaggerheartClassDefinition,
  DaggerheartClassKey,
  DaggerheartTraitDefinition,
} from "../types";
import { bardDefinition } from "./bard";
import { druidDefinition } from "./druid";
import { guardianDefinition } from "./guardian";
import { rangerDefinition } from "./ranger";
import { rogueDefinition } from "./rogue";
import { seraphDefinition } from "./seraph";
import { sorcererDefinition } from "./sorcerer";
import { warriorDefinition } from "./warrior";
import { wizardDefinition } from "./wizard";

export const traitData: DaggerheartTraitDefinition[] = [
  {
    key: "agility",
    label: {
      "pt-BR": "Agilidade",
      "en-US": "Agility",
    },
    skills: {
      "pt-BR": ["Correr", "Saltar", "Manobrar"],
      "en-US": ["Sprint", "Leap", "Maneuver"],
    },
  },
  {
    key: "strength",
    label: {
      "pt-BR": "Força",
      "en-US": "Strength",
    },
    skills: {
      "pt-BR": ["Erguer", "Esmagar", "Agarrar"],
      "en-US": ["Lift", "Smash", "Grapple"],
    },
  },
  {
    key: "finesse",
    label: {
      "pt-BR": "Acuidade",
      "en-US": "Finesse",
    },
    skills: {
      "pt-BR": ["Controlar", "Esconder", "Consertar"],
      "en-US": ["Control", "Hide", "Tinker"],
    },
  },
  {
    key: "instinct",
    label: {
      "pt-BR": "Instinto",
      "en-US": "Instinct",
    },
    skills: {
      "pt-BR": ["Perceber", "Sentir", "Navegar"],
      "en-US": ["Perceive", "Sense", "Navigate"],
    },
  },
  {
    key: "presence",
    label: {
      "pt-BR": "Presença",
      "en-US": "Presence",
    },
    skills: {
      "pt-BR": ["Encantar", "Performar", "Enganar"],
      "en-US": ["Charm", "Perform", "Deceive"],
    },
  },
  {
    key: "knowledge",
    label: {
      "pt-BR": "Conhecimento",
      "en-US": "Knowledge",
    },
    skills: {
      "pt-BR": ["Recordar", "Analisar", "Compreender"],
      "en-US": ["Recall", "Analyze", "Comprehend"],
    },
  },
];

export const daggerheartClasses: Record<
  DaggerheartClassKey,
  DaggerheartClassDefinition
> = {
  bard: bardDefinition,
  druid: druidDefinition,
  guardian: guardianDefinition,
  ranger: rangerDefinition,
  rogue: rogueDefinition,
  seraph: seraphDefinition,
  sorcerer: sorcererDefinition,
  warrior: warriorDefinition,
  wizard: wizardDefinition,
};
