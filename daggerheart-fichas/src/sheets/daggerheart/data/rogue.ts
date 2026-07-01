import type { DaggerheartClassDefinition } from "../types";

export const rogueDefinition: DaggerheartClassDefinition = {
  key: "rogue",

  title: {
    "pt-BR": "Ladino",
    "en-US": "Rogue",
  },

  domains: {
    "pt-BR": "Meia-Noite & Graça",
    "en-US": "Midnight & Grace",
  },

  evasionStart: 12,

  hopeFeature: {
    title: {
      "pt-BR": "Esquiva do Ladino",
      "en-US": "Rogue’s Dodge",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para ganhar +2 de bônus na sua Evasão até a próxima vez que um ataque tiver sucesso contra você. Caso contrário, esse bônus dura até seu próximo descanso.",
      "en-US": "Spend 3 Hope to gain a +2 bonus to your Evasion until the next time an attack succeeds against you. Otherwise, this bonus lasts until your next rest.",
    },
  },

  suggestedTraits: {
    "pt-BR": "+1 Agilidade, -1 Força, +2 Acuidade, 0 Instinto, +1 Presença, 0 Conhecimento.",
    "en-US": "+1 Agility, -1 Strength, +2 Finesse, 0 Instinct, +1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Adaga - Acuidade Corpo a corpo - d8+1 físico - Uma mão.",
    "en-US": "Dagger - Finesse Melee - d8+1 phy - One-Handed.",
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
        "Conjunto de ferramentas de falsificação ou gancho de escalada",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Set of forgery tools or grappling hook",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Encoberto / Ataque Furtivo",
      "en-US": "Cloaked / Sneak Attack",
    },
    description: {
      "pt-BR": `ENCOBERTO
Sempre que você ficaria Escondido, em vez disso fica Encoberto. Além dos benefícios da condição Escondido, enquanto estiver Encoberto você permanece invisível se estiver parado quando um adversário se mover para onde normalmente veria você. Depois de fazer um ataque ou terminar um movimento dentro da linha de visão de um adversário, você deixa de estar Encoberto.

ATAQUE FURTIVO
Quando você tem sucesso em um ataque enquanto está Encoberto ou enquanto um aliado está dentro do alcance Corpo a corpo do seu alvo, adicione à sua rolagem de dano uma quantidade de d6 igual ao seu tier.

Nível 1 é Tier 1. Níveis 2-4 são Tier 2. Níveis 5-7 são Tier 3. Níveis 8-10 são Tier 4.`,
      "en-US": `CLOAKED
Any time you would be Hidden, you are instead Cloaked. In addition to the benefits of the Hidden condition, while Cloaked you remain unseen if you are stationary when an adversary moves to where they would normally see you. After you make an attack or end a move within line of sight of an adversary, you are no longer Cloaked.

SNEAK ATTACK
When you succeed on an attack while Cloaked or while an ally is within Melee range of your target, add a number of d6s equal to your tier to your damage roll.

Level 1 is Tier 1. Levels 2-4 are Tier 2. Levels 5-7 are Tier 3. Levels 8-10 are Tier 4.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "O que você foi pego fazendo que levou ao seu exílio da comunidade natal?",
      "Você costumava ter uma vida diferente, mas tentou deixá-la para trás. Quem do seu passado ainda está perseguindo você?",
      "De quem do seu passado você ficou mais triste ao se despedir?",
    ],
    "en-US": [
      "What did you get caught doing that got you exiled from your home community?",
      "You used to have a different life, but you’ve tried to leave it behind. Who from your past is still chasing you?",
      "Who from your past were you most sad to say goodbye to?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "O que eu convenci você a fazer recentemente que colocou nós dois em apuros?",
      "O que descobri sobre o seu passado que guardo em segredo dos outros?",
      "Quem você conhece do meu passado, e como essa pessoa influenciou seus sentimentos sobre mim?",
    ],
    "en-US": [
      "What did I recently convince you to do that got us both in trouble?",
      "What have I discovered about your past that I hold secret from the others?",
      "Who do you know from my past, and how have they influenced your feelings about me?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["limpas", "escuras", "discretas", "de couro", "assustadoras", "táticas", "justas"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["bandido", "vigarista", "apostador", "chefe do crime", "pirata"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["clean", "dark", "inconspicuous", "leather", "scary", "tactical", "tight"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["bandit", "con artist", "gambler", "mob boss", "pirate"] },
    ],
  },
};
