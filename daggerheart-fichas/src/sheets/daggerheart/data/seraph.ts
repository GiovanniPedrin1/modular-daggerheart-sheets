import type { DaggerheartClassDefinition } from "../types";

export const seraphDefinition: DaggerheartClassDefinition = {
  key: "seraph",

  title: {
    "pt-BR": "Serafim",
    "en-US": "Seraph",
  },

  domains: {
    "pt-BR": "Esplendor & Valor",
    "en-US": "Splendor & Valor",
  },

  evasionStart: 9,

  hopeFeature: {
    title: {
      "pt-BR": "Suporte de Vida",
      "en-US": "Life Support",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para limpar um Ponto de Vida de um aliado dentro do alcance Perto.",
      "en-US": "Spend 3 Hope to clear a Hit Point on an ally within Close range.",
    },
  },

  suggestedTraits: {
    "pt-BR":
      "0 Agilidade, +2 Força, 0 Acuidade, +1 Instinto, +1 Presença, -1 Conhecimento.",
    "en-US":
      "0 Agility, +2 Strength, 0 Finesse, +1 Instinct, +1 Presence, -1 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR":
      "Machado Consagrado - Força Corpo a corpo - d8+1 mágico - Uma mão.",
    "en-US":
      "Hallowed Axe - Strength Melee - d8+1 mag - One-Handed.",
  },

  suggestedSecondaryWeapon: {
    "pt-BR":
      "Escudo Redondo - Força Corpo a corpo - d4 físico - Uma mão; Protetor: +1 na Pontuação de Armadura.",
    "en-US":
      "Round Shield - Strength Melee - d4 phy - One-Handed; Protective: +1 Armor Score.",
  },

  suggestedArmor: {
    "pt-BR":
      "Armadura de Cota de Malha - Limiares 7/15 - Pontuação 4; Pesada: -1 na Evasão.",
    "en-US":
      "Chainmail Armor - Thresholds 7/15 - Score 4; Heavy: -1 Evasion.",
  },

  startingInventory: {
    fixed: {
      "pt-BR": [
        "Uma tocha",
        "50 pés de corda",
        "Suprimentos básicos",
        "Um punhado de ouro",
      ],
      "en-US": [
        "A torch",
        "50 feet of rope",
        "Basic supplies",
        "One handful of gold",
      ],
    },
    choices: {
      "pt-BR": [
        "Poção de Vida Menor ou Poção de Vigor Menor",
        "Pacote de oferendas ou sigilo do seu deus",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Bundle of offerings or sigil of your god",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Dados de Oração",
      "en-US": "Prayer Dice",
    },
    spellcastTraitLabel: {
      "pt-BR": "Traço de Spellcast",
      "en-US": "Spellcast trait",
    },
    description: {
      "pt-BR":
        "No começo de cada sessão, role uma quantidade de d4 igual ao traço de Spellcast da sua subclasse e coloque-os aqui. Você pode gastar Dados de Oração para ajudar você ou um aliado dentro do alcance Longe: reduza dano recebido, adicione o resultado a uma rolagem depois que ela for feita, ou ganhe Hope igual ao resultado do dado. Limpe dados não gastos no final de cada sessão.",
      "en-US":
        "At the beginning of each session, roll a number of d4s equal to your subclass's Spellcast trait and place them here. You can spend Prayer Dice to aid yourself or an ally within Far range: reduce incoming damage, add to a roll after it is made, or gain Hope equal to the die result. Clear unspent dice at the end of each session.",
    },
    tracker: {
      name: "prayer_dice",
      label: {
        "pt-BR": "Dados de Oração",
        "en-US": "Prayer Dice",
      },
      count: 6,
      kind: "number",
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "A qual deus você se devotou? Que feito incrível ele realizou por você em um momento de desespero?",
      "Como sua aparência mudou depois que você fez seu juramento?",
      "De que forma estranha ou única você se comunica com seu deus?",
    ],
    "en-US": [
      "Which god did you devote yourself to? What incredible feat did they perform for you in a moment of desperation?",
      "How did your appearance change after taking your oath?",
      "In what strange or unique way do you communicate with your god?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Que promessa você me fez aceitar, caso morra no campo de batalha?",
      "Por que você me faz tantas perguntas sobre meu deus?",
      "Você me disse para proteger um membro do nosso grupo acima de todos os outros, até mesmo acima de você. Quem é essa pessoa e por quê?",
    ],
    "en-US": [
      "What promise did you make me agree to, should you die on the battlefield?",
      "Why do you ask me so many questions about my god?",
      "You’ve told me to protect one member of our party above all others, even yourself. Who are they and why?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      {
        label: "Roupas",
        values: ["brilhantes", "ondulantes", "ornadas", "justas", "modestas", "estranhas", "naturais"],
      },
      {
        label: "Olhos",
        values: [
          "cravos",
          "terra",
          "oceano infinito",
          "fogo",
          "hera",
          "lilases",
          "noite",
          "espuma do mar",
          "inverno",
        ],
      },
      {
        label: "Corpo",
        values: [
          "largo",
          "esculpido",
          "curvilíneo",
          "esguio",
          "robusto",
          "baixo",
          "atarracado",
          "alto",
          "magro",
          "minúsculo",
          "tonificado",
        ],
      },
      {
        label: "Pele",
        values: [
          "cinzas",
          "trevo",
          "neve caindo",
          "areia fina",
          "obsidiana",
          "rosa",
          "safira",
          "glicínia",
        ],
      },
      {
        label: "Atitude",
        values: ["anjo", "médico", "evangelista", "monge", "sacerdote"],
      },
    ],
    "en-US": [
      {
        label: "Clothes",
        values: ["glowing", "rippling", "ornate", "tight", "modest", "strange", "natural"],
      },
      {
        label: "Eyes",
        values: [
          "carnations",
          "earth",
          "endless ocean",
          "fire",
          "ivy",
          "lilacs",
          "night",
          "seafoam",
          "winter",
        ],
      },
      {
        label: "Body",
        values: [
          "broad",
          "carved",
          "curvy",
          "lanky",
          "rotund",
          "short",
          "stocky",
          "tall",
          "thin",
          "tiny",
          "toned",
        ],
      },
      {
        label: "Skin",
        values: [
          "ashes",
          "clover",
          "falling snow",
          "fine sand",
          "obsidian",
          "rose",
          "sapphire",
          "wisteria",
        ],
      },
      {
        label: "Attitude",
        values: ["angel", "doctor", "evangelist", "monk", "priest"],
      },
    ],
  },
};
