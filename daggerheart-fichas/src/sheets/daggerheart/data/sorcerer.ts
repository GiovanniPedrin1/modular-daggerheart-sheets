import type { DaggerheartClassDefinition } from "../types";

export const sorcererDefinition: DaggerheartClassDefinition = {
  key: "sorcerer",

  title: {
    "pt-BR": "Feiticeiro",
    "en-US": "Sorcerer",
  },

  domains: {
    "pt-BR": "Arcana & Meia-Noite",
    "en-US": "Arcana & Midnight",
  },

  evasionStart: 10,

  hopeFeature: {
    title: {
      "pt-BR": "Magia Volátil",
      "en-US": "Volatile Magic",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para rolar novamente qualquer quantidade dos seus dados de dano em um ataque que cause dano mágico.",
      "en-US": "Spend 3 Hope to reroll any number of your damage dice on an attack that deals magic damage.",
    },
  },

  suggestedTraits: {
    "pt-BR": "0 Agilidade, -1 Força, +1 Acuidade, +2 Instinto, +1 Presença, 0 Conhecimento.",
    "en-US": "0 Agility, -1 Strength, +1 Finesse, +2 Instinct, +1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Bastão Duplo - Instinto Longe - d6+3 mágico - Duas mãos.",
    "en-US": "Dualstaff - Instinct Far - d6+3 mag - Two-Handed.",
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
        "Orbe sussurrante ou relíquia de família",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Whispering orb or family heirloom",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Sentido Arcano / Ilusão Menor / Canalizar Poder Bruto",
      "en-US": "Arcane Sense / Minor Illusion / Channel Raw Power",
    },
    description: {
      "pt-BR": `SENTIDO ARCANO
Você pode sentir a presença de pessoas e objetos mágicos dentro do alcance Perto.

ILUSÃO MENOR
Faça uma Rolagem de Spellcast (10). Em um sucesso, você cria uma ilusão visual menor, não maior que você, dentro do alcance Perto. Essa ilusão é convincente para qualquer pessoa em alcance Perto ou mais distante.

CANALIZAR PODER BRUTO
Uma vez por descanso longo, você pode colocar uma carta de domínio da sua loadout em seu vault e escolher uma das opções:
- Ganhar Hope igual ao nível da carta.
- Aprimorar uma magia que causa dano, ganhando um bônus à sua rolagem de dano igual ao dobro do nível da carta.`,
      "en-US": `ARCANE SENSE
You can sense the presence of magical people and objects within Close range.

MINOR ILLUSION
Make a Spellcast Roll (10). On a success, you create a minor visual illusion no larger than yourself within Close range. This illusion is convincing to anyone at Close range or farther.

CHANNEL RAW POWER
Once per long rest, you can place a domain card from your loadout into your vault and choose to either:
- Gain Hope equal to the level of the card.
- Enhance a spell that deals damage, gaining a bonus to your damage roll equal to twice the level of the card.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "O que você fez que deixou as pessoas da sua comunidade receosas de você?",
      "Que mentor ensinou você a controlar sua magia indomada, e por que essa pessoa não pode mais guiar você?",
      "Você tem um medo profundo que esconde de todos. O que é e por que isso assusta você?",
    ],
    "en-US": [
      "What did you do that made the people in your community wary of you?",
      "What mentor taught you to control your untamed magic, and why are they no longer able to guide you?",
      "You have a deep fear you hide from everyone. What is it, and why does it scare you?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Por que você confia tão profundamente em mim?",
      "O que eu fiz que deixa você cauteloso perto de mim?",
      "Por que mantemos nosso passado compartilhado em segredo?",
    ],
    "en-US": [
      "Why do you trust me so deeply?",
      "What did I do that makes you cautious around me?",
      "Why do we keep our shared past a secret?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["sempre em movimento", "extravagantes", "discretas", "em camadas", "ornadas", "justas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["celebridade", "comandante", "político", "brincalhão", "lobo em pele de cordeiro"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["always moving", "flamboyant", "inconspicuous", "layered", "ornate", "tight"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["celebrity", "commander", "politician", "prankster", "wolf in sheep’s clothing"] },
    ],
  },
};
