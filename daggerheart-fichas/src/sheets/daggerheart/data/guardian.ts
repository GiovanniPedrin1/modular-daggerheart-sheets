import type { DaggerheartClassDefinition } from "../types";

export const guardianDefinition: DaggerheartClassDefinition = {
  key: "guardian",

  title: {
    "pt-BR": "Guardião",
    "en-US": "Guardian",
  },

  domains: {
    "pt-BR": "Valor & Lâmina",
    "en-US": "Valor & Blade",
  },

  evasionStart: 9,

  hopeFeature: {
    title: {
      "pt-BR": "Tanque da Linha de Frente",
      "en-US": "Frontline Tank",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para limpar 2 Slots de Armadura.",
      "en-US": "Spend 3 Hope to clear 2 Armor Slots.",
    },
  },

  suggestedTraits: {
    "pt-BR": "+1 Agilidade, +2 Força, -1 Acuidade, 0 Instinto, +1 Presença, 0 Conhecimento.",
    "en-US": "+1 Agility, +2 Strength, -1 Finesse, 0 Instinct, +1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Machado de Batalha - Força Corpo a corpo - d10+3 físico - Duas mãos.",
    "en-US": "Battleaxe - Strength Melee - d10+3 phy - Two-Handed.",
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
        "Totem do seu mentor ou chave secreta",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Totem from your mentor or secret key",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Imparável",
      "en-US": "Unstoppable",
    },
    description: {
      "pt-BR": `Uma vez por descanso longo, você pode se tornar Imparável. Você ganha um Dado Imparável. No nível 1, seu Dado Imparável é um d4. Coloque-o nesta ficha no espaço apropriado, começando com o valor 1 virado para cima.

Depois de fazer uma rolagem de dano que cause 1 ou mais Pontos de Vida a um alvo, aumente o valor do Dado Imparável em um. Quando o valor do dado excederia seu valor máximo ou quando a cena terminar, remova o dado e deixe de estar Imparável. No nível 5, seu Dado Imparável aumenta para d6.

Enquanto estiver Imparável, você ganha estes benefícios:
- Você reduz a severidade de dano físico em um limiar (Severo para Maior, Maior para Menor, Menor para Nenhum).
- Você adiciona o valor atual do Dado Imparável à sua rolagem de dano.
- Você não pode ser Restringido nem Vulnerável.`,
      "en-US": `Once per long rest, you can become Unstoppable. You gain an Unstoppable Die. At level 1, your Unstoppable Die is a d4. Place it on this sheet in the space provided, starting with the 1 value facing up.

After you make a damage roll that deals 1 or more Hit Points to a target, increase the Unstoppable Die value by one. When the die’s value would exceed its maximum value or when the scene ends, remove the die and drop out of Unstoppable. At level 5, your Unstoppable Die increases to a d6.

While Unstoppable, you gain the following benefits:
- You reduce the severity of physical damage by one threshold (Severe to Major, Major to Minor, Minor to None).
- You add the current value of the Unstoppable Die to your damage roll.
- You can’t be Restrained or Vulnerable.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Quem da sua comunidade você falhou em proteger, e por que ainda pensa nessa pessoa?",
      "Você recebeu a tarefa de proteger algo importante e entregá-lo em algum lugar perigoso. O que é e para onde precisa ir?",
      "Você considera um aspecto de si mesmo uma fraqueza. O que é e como isso afetou você?",
    ],
    "en-US": [
      "Who from your community did you fail to protect, and why do you still think of them?",
      "You’ve been tasked with protecting something important and delivering it somewhere dangerous. What is it, and where does it need to go?",
      "You consider an aspect of yourself to be a weakness. What is it, and how has it affected you?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "Como eu salvei sua vida na primeira vez que nos encontramos?",
      "Que pequeno presente você me deu e percebe que eu sempre carrego comigo?",
      "Que mentira você contou sobre si mesmo que eu acredito completamente?",
    ],
    "en-US": [
      "How did I save your life the first time we met?",
      "What small gift did you give me that you notice I always carry with me?",
      "What lie have you told me about yourself that I absolutely believe?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["casuais", "intrincadas", "folgadas", "acolchoadas", "reais", "táticas", "desgastadas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["capitão", "cuidador", "elefante", "general", "lutador"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["casual", "intricate", "loose", "padded", "royal", "tactical", "weathered"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["captain", "caretaker", "elephant", "general", "wrestler"] },
    ],
  },
};
