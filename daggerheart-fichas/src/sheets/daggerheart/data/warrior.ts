import type { DaggerheartClassDefinition } from "../types";

export const warriorDefinition: DaggerheartClassDefinition = {
  key: "warrior",

  title: {
    "pt-BR": "Guerreiro",
    "en-US": "Warrior",
  },

  domains: {
    "pt-BR": "Lâmina & Ossos",
    "en-US": "Blade & Bone",
  },

  evasionStart: 11,

  hopeFeature: {
    title: {
      "pt-BR": "Sem Misericórdia",
      "en-US": "No Mercy",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para ganhar +1 de bônus nas suas rolagens de ataque até seu próximo descanso.",
      "en-US": "Spend 3 Hope to gain a +1 bonus to your attack rolls until your next rest.",
    },
  },

  suggestedTraits: {
    "pt-BR": "+2 Agilidade, +1 Força, 0 Acuidade, +1 Instinto, -1 Presença, 0 Conhecimento.",
    "en-US": "+2 Agility, +1 Strength, 0 Finesse, +1 Instinct, -1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Espada Longa - Agilidade Corpo a corpo - d8+3 físico - Duas mãos.",
    "en-US": "Longsword - Agility Melee - d8+3 phy - Two-Handed.",
  },

  suggestedArmor: {
    "pt-BR": "Armadura de Cota de Malha - Limiares 7/15 - Pontuação 4; Pesada: -1 na Evasão.",
    "en-US": "Chainmail Armor - Thresholds 7/15 - Score 4; Heavy: -1 to Evasion.",
  },

  startingInventory: {
    fixed: {
      "pt-BR": ["Uma tocha", "50 pés de corda", "Suprimentos básicos", "Um punhado de ouro"],
      "en-US": ["A torch", "50 feet of rope", "Basic supplies", "One handful of gold"],
    },
    choices: {
      "pt-BR": [
        "Poção de Vida Menor ou Poção de Vigor Menor",
        "Desenho de uma pessoa amada ou pedra de afiar",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Drawing of a lover or sharpening stone",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Ataque de Oportunidade / Treinamento de Combate",
      "en-US": "Attack of Opportunity / Combat Training",
    },
    description: {
      "pt-BR": `ATAQUE DE OPORTUNIDADE
Quando um adversário dentro do alcance Corpo a corpo tenta sair desse alcance, faça uma rolagem de reação usando um traço à sua escolha contra a Dificuldade dele. Escolha um efeito em um sucesso, ou dois em um sucesso crítico:
- Ele não pode se mover de onde está.
- Você causa dano a ele igual ao dano da sua arma primária.
- Você se move junto com ele.

TREINAMENTO DE COMBATE
Você ignora burden ao equipar armas. Quando causa dano físico, você ganha um bônus à sua rolagem de dano igual ao seu nível.`,
      "en-US": `ATTACK OF OPPORTUNITY
When an adversary within Melee range attempts to leave that range, make a reaction roll using a trait of your choice against their Difficulty. Choose one effect on a success, or two if you critically succeed:
- They can’t move from where they are.
- You deal damage to them equal to your primary weapon’s damage.
- You move with them.

COMBAT TRAINING
You ignore burden when equipping weapons. When you deal physical damage, you gain a bonus to your damage roll equal to your level.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Quem ensinou você a lutar, e por que essa pessoa ficou para trás quando você saiu de casa?",
      "Alguém derrotou você em batalha anos atrás e deixou você para morrer. Quem foi e como essa pessoa traiu você?",
      "Que lugar lendário você sempre quis visitar, e por que ele é tão especial?",
    ],
    "en-US": [
      "Who taught you to fight, and why did they stay behind when you left home?",
      "Somebody defeated you in battle years ago and left you to die. Who was it, and how did they betray you?",
      "What legendary place have you always wanted to visit, and why is it so special?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Nós nos conhecíamos muito antes deste grupo se formar. Como?",
      "Com que tarefa mundana você costuma me ajudar fora do campo de batalha?",
      "Que medo estou ajudando você a superar?",
    ],
    "en-US": [
      "We knew each other long before this party came together. How?",
      "What mundane task do you usually help me with off the battlefield?",
      "What fear am I helping you overcome?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["ousadas", "remendadas", "reforçadas", "reais", "elegantes", "econômicas", "desgastadas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["touro", "soldado dedicado", "gladiador", "herói", "mercenário"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["bold", "patched", "reinforced", "royal", "sleek", "sparing", "weathered"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["bull", "dedicated soldier", "gladiator", "hero", "hired hand"] },
    ],
  },
};
