import type { DaggerheartClassDefinition } from "../types";

export const wizardDefinition: DaggerheartClassDefinition = {
  key: "wizard",

  title: {
    "pt-BR": "Mago",
    "en-US": "Wizard",
  },

  domains: {
    "pt-BR": "Códice & Esplendor",
    "en-US": "Codex & Splendor",
  },

  evasionStart: 11,

  hopeFeature: {
    title: {
      "pt-BR": "Desta Vez Não",
      "en-US": "Not This Time",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para forçar um adversário dentro do alcance Longe a rolar novamente uma rolagem de ataque ou de dano.",
      "en-US": "Spend 3 Hope to force an adversary within Far range to reroll an attack or damage roll.",
    },
  },

  suggestedTraits: {
    "pt-BR": "-1 Agilidade, 0 Força, 0 Acuidade, +1 Instinto, +1 Presença, +2 Conhecimento.",
    "en-US": "-1 Agility, 0 Strength, 0 Finesse, +1 Instinct, +1 Presence, +2 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Cajado Grande - Conhecimento Muito Longe - d6 mágico - Duas mãos; Poderoso: em um ataque bem-sucedido, role um dado de dano adicional e descarte o menor resultado.",
    "en-US": "Greatstaff - Knowledge Very Far - d6 mag - Two-Handed; Powerful: On a successful attack, roll an additional damage die and discard the lowest result.",
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
        "Livro que você está tentando traduzir ou pequeno pet elemental inofensivo",
        "Decida onde carrega seus feitiços: grandes tomos, cartas de tarô, etc.",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Book you’re trying to translate or tiny, harmless elemental pet",
        "Decide what you carry your spells in: large tomes, tarot cards, etc.",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Prestidigitação / Padrões Estranhos",
      "en-US": "Prestidigitation / Strange Patterns",
    },
    description: {
      "pt-BR": `PRESTIDIGITAÇÃO
Você pode realizar efeitos mágicos inofensivos e sutis à vontade. Por exemplo, pode mudar a cor de um objeto, criar um cheiro, acender uma vela, fazer um objeto minúsculo flutuar, iluminar uma sala ou reparar um objeto pequeno.

PADRÕES ESTRANHOS
Escolha um número entre 1 e 12. Quando você rolar esse número em um Dado de Dualidade, ganhe 1 Hope ou limpe 1 Stress. Você pode mudar esse número quando fizer um descanso longo.`,
      "en-US": `PRESTIDIGITATION
You can perform harmless, subtle magical effects at will. For example, you can change an object’s color, create a smell, light a candle, cause a tiny object to float, illuminate a room, or repair a small object.

STRANGE PATTERNS
Choose a number between 1 and 12. When you roll that number on a Duality Die, gain a Hope or clear a Stress. You can change this number when you take a long rest.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Com quais responsabilidades sua comunidade contava que você lidasse? Como você decepcionou essas pessoas?",
      "Você passou a vida procurando um livro ou objeto de grande importância. O que é e por que é tão importante para você?",
      "Você tem um rival poderoso. Quem é essa pessoa e por que você está tão determinado a derrotá-la?",
    ],
    "en-US": [
      "What responsibilities did your community once count on you for? How did you let them down?",
      "You’ve spent your life searching for a book or object of great significance. What is it, and why is it so important to you?",
      "You have a powerful rival. Who are they, and why are you so determined to defeat them?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Que favor eu pedi a você que você não tem certeza se pode cumprir?",
      "Que hobby estranho ou fascínio peculiar nós dois compartilhamos?",
      "Que segredo sobre si mesmo você confiou apenas a mim?",
    ],
    "en-US": [
      "What favor have I asked of you that you’re not sure you can fulfill?",
      "What weird hobby or strange fascination do we both share?",
      "What secret about yourself have you entrusted only to me?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["belas", "limpas", "comuns", "fluidas", "em camadas", "remendadas", "justas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["excêntrico", "bibliotecário", "pavio aceso", "filósofo", "professor"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["beautiful", "clean", "common", "flowing", "layered", "patchwork", "tight"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["eccentric", "librarian", "lit fuse", "philosopher", "professor"] },
    ],
  },
};
