import type { DaggerheartClassDefinition } from "../types";
import { druidBeastforms } from "./druidBeastforms";

export const druidDefinition: DaggerheartClassDefinition = {
  key: "druid",

  title: {
    "pt-BR": "Druida",
    "en-US": "Druid",
  },

  domains: {
    "pt-BR": "Sábio & Arcana",
    "en-US": "Sage & Arcana",
  },

  evasionStart: 10,

  hopeFeature: {
    title: {
      "pt-BR": "Evolução",
      "en-US": "Evolution",
    },
    description: {
      "pt-BR": "Gaste 3 Hope para se transformar em Beastform sem marcar Stress. Quando fizer isso, escolha um traço para aumentar em +1 até sair dessa Beastform.",
      "en-US": "Spend 3 Hope to transform into Beastform without marking a Stress. When you do, choose one trait to raise by +1 until you drop out of that Beastform.",
    },
  },

  beastforms: druidBeastforms,

  suggestedTraits: {
    "pt-BR": "+1 Agilidade, 0 Força, +1 Acuidade, +2 Instinto, -1 Presença, 0 Conhecimento.",
    "en-US": "+1 Agility, 0 Strength, +1 Finesse, +2 Instinct, -1 Presence, 0 Knowledge.",
  },

  suggestedPrimaryWeapon: {
    "pt-BR": "Bastão Curto - Instinto Perto - d8+1 mágico - Uma mão.",
    "en-US": "Shortstaff - Instinct Close - d8+1 mag - One-Handed.",
  },

  suggestedSecondaryWeapon: {
    "pt-BR": "Escudo Redondo - Força Corpo a corpo - d4 físico - Uma mão; Protetor: +1 na Pontuação de Armadura.",
    "en-US": "Round Shield - Strength Melee - d4 phy - One-Handed; Protective: +1 to Armor Score.",
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
        "Pequena bolsa de pedras e ossos ou pingente estranho encontrado na terra",
      ],
      "en-US": [
        "Minor Health Potion or Minor Stamina Potion",
        "Small bag of rocks and bones or strange pendant found in the dirt",
      ],
    },
  },

  classFeature: {
    title: {
      "pt-BR": "Beastform / Wildtouch",
      "en-US": "Beastform / Wildtouch",
    },
    description: {
      "pt-BR": `BEASTFORM
Marque 1 Stress para se transformar magicamente em uma criatura do seu tier ou inferior da lista de Beastform. Você pode sair dessa forma a qualquer momento. Enquanto transformado, você não pode usar armas nem conjurar magias de cartas de domínio, mas ainda pode usar outras features ou habilidades a que tenha acesso. Magias conjuradas antes da transformação permanecem ativas por sua duração normal, e você pode falar e se comunicar normalmente. Além disso, você ganha as features da Beastform, adiciona o bônus de Evasão dela à sua Evasão e usa o traço especificado nas estatísticas dela para atacar. Enquanto estiver em Beastform, sua armadura se torna parte do seu corpo e você marca Slots de Armadura normalmente; quando sai da Beastform, esses Slots de Armadura marcados continuam marcados. Se você marcar seu último Ponto de Vida, sai automaticamente dessa forma.

WILDTOUCH
Você pode realizar efeitos inofensivos e sutis que envolvem a natureza - como fazer uma flor crescer rapidamente, invocar uma leve rajada de vento ou acender uma fogueira - à vontade.`,
      "en-US": `BEASTFORM
Mark a Stress to magically transform into a creature of your tier or lower from the Beastform list. You can drop out of this form at any time. While transformed, you can’t use weapons or cast spells from domain cards, but you can still use other features or abilities you have access to. Spells you cast before you transform stay active and last for their normal duration, and you can talk and communicate as normal. Additionally, you gain the Beastform’s features, add their Evasion bonus to your Evasion, and use the trait specified in their statistics for your attack. While you’re in a Beastform, your armor becomes part of your body and you mark Armor Slots as usual; when you drop out of a Beastform, those marked Armor Slots remain marked. If you mark your last Hit Point, you automatically drop out of this form.

WILDTOUCH
You can perform harmless, subtle effects that involve nature - such as causing a flower to rapidly grow, summoning a slight gust of wind, or starting a campfire - at will.`,
    },
  },

  backgroundQuestions: {
    "pt-BR": [
      "Por que a comunidade em que você cresceu dependia tanto da natureza e de suas criaturas?",
      "Qual foi o primeiro animal selvagem com quem você criou vínculo? Por que esse vínculo acabou?",
      "Quem tem tentado caçar você? O que essa pessoa quer de você?",
    ],
    "en-US": [
      "Why was the community you grew up in so reliant on nature and its creatures?",
      "Who was the first wild animal you bonded with? Why did your bond end?",
      "Who has been trying to hunt you down? What do they want from you?",
    ],
  },

  connectionQuestions: {
    "pt-BR": [
      "O que você confidenciou a mim que me faz saltar para o perigo por você toda vez?",
      "Com que animal eu digo que você se parece?",
      "Que apelido carinhoso você me deu?",
    ],
    "en-US": [
      "What did you confide in me that makes me leap into danger for you every time?",
      "What animal do I say you remind me of?",
      "What affectionate nickname have you given me?",
    ],
  },

  startingExperiencePlaceholder: {
    "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
    "en-US": "Work with the GM to create two starting experiences.",
  },

  appearanceSuggestions: {
    "pt-BR": [
      { label: "Roupas", values: ["camufladas", "crescidas", "folgadas", "naturais", "remendadas", "régias", "em retalhos"] },
      { label: "Olhos", values: ["cravos", "terra", "oceano infinito", "fogo", "hera", "lilases", "noite", "espuma do mar", "inverno"] },
      { label: "Corpo", values: ["largo", "esculpido", "curvilíneo", "esguio", "robusto", "baixo", "atarracado", "alto", "magro", "minúsculo", "tonificado"] },
      { label: "Pele", values: ["cinzas", "trevo", "neve caindo", "areia fina", "obsidiana", "rosa", "safira", "glicínia"] },
      { label: "Atitude", values: ["foguete", "raposa", "guia", "hippie", "bruxa"] },
    ],
    "en-US": [
      { label: "Clothes", values: ["camouflaged", "grown", "loose", "natural", "patchwork", "regal", "scraps"] },
      { label: "Eyes", values: ["carnations", "earth", "endless ocean", "fire", "ivy", "lilacs", "night", "seafoam", "winter"] },
      { label: "Body", values: ["broad", "carved", "curvy", "lanky", "rotund", "short", "stocky", "tall", "thin", "tiny", "toned"] },
      { label: "Skin", values: ["ashes", "clover", "falling snow", "fine sand", "obsidian", "rose", "sapphire", "wisteria"] },
      { label: "Attitude", values: ["firecracker", "fox", "guide", "hippie", "witch"] },
    ],
  },
};
