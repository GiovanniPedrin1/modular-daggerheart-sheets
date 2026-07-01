import type { DaggerheartClassDefinition } from "../types";

export const bardDefinition: DaggerheartClassDefinition = {
  key: "bard",

  title: {
    "pt-BR": "Bardo",
    "en-US": "Bard",
  },

  domains: {
    "pt-BR": "Graça & Códice",
    "en-US": "Grace & Codex",
  },

  evasionStart: 10,

  hopeFeature: {
    title: {
      "pt-BR": "Faça uma Cena",
      "en-US": "Make a Scene",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para Distrair temporariamente um alvo dentro do alcance Perto, dando a ele uma penalidade de -2 na Dificuldade.",
      "en-US": "Spend 3 Hope to temporarily Distract a target within Close range, giving them a -2 penalty to their Difficulty.",
    },
  },

  suggestedTraits: {
    "pt-BR": "0 Agilidade, -1 Força, +1 Acuidade, 0 Instinto, +2 Presença, +1 Conhecimento.",
    "en-US": "0 Agility, -1 Strength, +1 Finesse, 0 Instinct, +2 Presence, +1 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Rapieira - Presença Corpo a corpo - d8 físico - Uma mão; Rápida: ao fazer um ataque, você pode marcar 1 Stress para mirar outra criatura dentro do alcance.",
    "en-US": "Rapier - Presence Melee - d8 phy - One-Handed; Quick: When you make an attack, you can mark a Stress to target another creature within range.",
  },

  suggestedSecondaryWeapon: {
    "pt-BR": "Adaga Pequena - Acuidade Corpo a corpo - d8 físico - Uma mão; Pareada: +2 ao dano da arma primária contra alvos dentro do alcance Corpo a corpo.",
    "en-US": "Small Dagger - Finesse Melee - d8 phy - One-Handed; Paired: +2 to primary weapon damage to targets within Melee range.",
  },

  suggestedArmor: {
    "pt-BR": "Armadura Gambesão - Limiares 5/11 - Pontuação 3; Flexível: +1 na Evasão.",
    "en-US": "Gambeson Armor - Thresholds 5/11 - Score 3; Flexible: +1 to Evasion.",
  },

  startingInventory: {
    fixed: {
      "pt-BR": ["Uma tocha", "50 pés de corda", "Suprimentos básicos", "Um punhado de ouro"],
      "en-US": ["A torch", "50 feet of rope", "Basic supplies", "One handful of gold"],
    },
    choices: {
      "pt-BR": [
        "Poção de Vida Menor ou Poção de Vigor Menor",
        "Romance ou carta nunca aberta",
        "Decida onde carrega seus feitiços: livro de canções, diário, etc.",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Romance novel or letter never opened",
        "Decide what you carry your spells in: songbook, journal, etc.",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Rally",
      "en-US": "Rally",
    },
    description: {
      "pt-BR": `Uma vez por sessão, descreva como você anima o grupo e conceda a você e a cada um de seus aliados um Dado de Rally. No nível 1, seu Dado de Rally é um d6. Um PJ pode gastar seu Dado de Rally para rolá-lo, adicionando o resultado à rolagem de ação, reação, dano, ou para limpar uma quantidade de Stress igual ao resultado. No final de cada sessão, limpe todos os Dados de Rally não gastos.

No nível 5, seu Dado de Rally aumenta para d8.`,
      "en-US": `Once per session, describe how you rally the party and give yourself and each of your allies a Rally Die. At level 1, your Rally Die is a d6. A PC can spend their Rally Die to roll it, adding the result to their action roll, reaction roll, damage roll, or to clear a number of Stress equal to the result. At the end of each session, clear all unspent Rally Dice.

At level 5, your Rally Die increases to a d8.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Quem da sua comunidade ensinou você a ter tanta confiança em si mesmo?",
      "Você já esteve apaixonado. Quem você adorava e como essa pessoa machucou você?",
      "Você sempre admirou outro bardo. Quem é essa pessoa e por que você a idolatra?",
    ],
    "en-US": [
      "Who from your community taught you to have such confidence in yourself?",
      "You were in love once. Who did you adore, and how did they hurt you?",
      "You’ve always looked up to another bard. Who are they, and why do you idolize them?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "O que fez você perceber que seríamos tão bons amigos?",
      "O que eu faço que irrita você?",
      "Por que você segura minha mão à noite?",
    ],
    "en-US": [
      "What made you realize we were going to be such good friends?",
      "What do I do that annoys you?",
      "Why do you grab my hand at night?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["extravagantes", "elegantes", "chamativas", "grandes demais", "esfarrapadas", "estilosas", "selvagens"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["taberneiro", "mágico", "mestre de picadeiro", "estrela do rock", "espadachim aventureiro"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["extravagant", "fancy", "loud", "oversized", "ragged", "sleek", "wild"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["barkeep", "magician", "ringmaster", "rock star", "swashbuckler"] },
    ],
  },
};
