import type { DaggerheartClassDefinition } from "../types";
import { rangerCompanion } from "./rangerCompanion";

export const rangerDefinition: DaggerheartClassDefinition = {
  key: "ranger",

  title: {
    "pt-BR": "Patrulheiro",
    "en-US": "Ranger",
  },

  domains: {
    "pt-BR": "Ossos & Sábio",
    "en-US": "Bone & Sage",
  },

  evasionStart: 12,

  hopeFeature: {
    title: {
      "pt-BR": "Mantenha-os à Distância",
      "en-US": "Hold Them Off",
    },
    description: {
      "pt-BR": "Gaste 3 Hope quando tiver sucesso em um ataque com uma arma para usar essa mesma rolagem contra dois adversários adicionais dentro do alcance do ataque.",
      "en-US": "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll against two additional adversaries within range of the attack.",
    },
  },

  companion: rangerCompanion,

  suggestedTraits: {
    "pt-BR": "+2 Agilidade, 0 Força, +1 Acuidade, +1 Instinto, -1 Presença, 0 Conhecimento.",
    "en-US": "+2 Agility, 0 Strength, +1 Finesse, +1 Instinct, -1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Arco Curto - Agilidade Longe - d6+3 físico - Duas mãos.",
    "en-US": "Shortbow - Agility Far - d6+3 phy - Two-Handed.",
  },

  suggestedArmor: {
    "pt-BR": "Armadura de Couro - Limiares 6/13 - Pontuação 3.",
    "en-US": "Leather Armor - Thresholds 6/13 - Score 3.",
  },

  startingInventory: {
    fixed: {
      "pt-BR": ["Uma tocha", "50 pés de corda", "Suprimentos básicos", "Um punhado de ouro"],
      "en-US": ["A torch", "50 feet of rope", "Basic supplies", "One handful of gold"],
    },
    choices: {
      "pt-BR": [
        "Poção de Vida Menor ou Poção de Vigor Menor",
        "Troféu da sua primeira caça ou bússola aparentemente quebrada",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Trophy from your first kill or seemingly broken compass",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Foco do Patrulheiro",
      "en-US": "Ranger’s Focus",
    },
    description: {
      "pt-BR": `Gaste 1 Hope e faça um ataque contra um alvo. Em um sucesso, cause o dano normal do ataque e torne temporariamente o alvo do ataque seu Foco. Até esta feature terminar ou você transformar uma criatura diferente em seu Foco, você ganha os seguintes benefícios contra seu Foco:

- Você sabe precisamente em que direção ele está.
- Quando você causa dano a ele, ele deve marcar 1 Stress.
- Quando você falha em um ataque contra ele, pode encerrar seu Foco do Patrulheiro para rolar novamente seus Dados de Dualidade.`,
      "en-US": `Spend a Hope and make an attack against a target. On a success, deal your attack’s normal damage and temporarily make the attack’s target your Focus. Until this feature ends or you make a different creature your Focus, you gain the following benefits against your Focus:

- You know precisely what direction they are in.
- When you deal damage to them, they must mark a Stress.
- When you fail an attack against them, you can end your Ranger’s Focus feature to reroll your Duality Dice.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Uma criatura terrível feriu sua comunidade, e você jurou caçá-la. O que ela é e que rastro ou sinal único ela deixa para trás?",
      "Sua primeira caça quase matou você também. O que foi, e que parte de você nunca mais foi a mesma depois desse evento?",
      "Você já viajou por muitas terras perigosas, mas qual é o único lugar aonde se recusa a ir?",
    ],
    "en-US": [
      "A terrible creature hurt your community, and you’ve vowed to hunt them down. What are they, and what unique trail or sign do they leave behind?",
      "Your first kill almost killed you, too. What was it, and what part of you was never the same after that event?",
      "You’ve traveled many dangerous lands, but what is the one place you refuse to go?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Que competição amigável nós temos?",
      "Por que você age de forma diferente quando estamos a sós do que quando há outras pessoas por perto?",
      "Que ameaça você me pediu para vigiar, e por que está preocupado com ela?",
    ],
    "en-US": [
      "What friendly competition do we have?",
      "Why do you act differently when we’re alone than when others are around?",
      "What threat have you asked me to watch for, and why are you worried about it?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["fluidas", "discretas", "naturais", "manchadas", "táticas", "justas", "tecidas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["criança", "fantasma", "sobrevivencialista", "professor", "cão de guarda"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["flowing", "muted", "natural", "stained", "tactical", "tight", "woven"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["child", "ghost", "survivalist", "teacher", "watchdog"] },
    ],
  },
};
