import type {
  DaggerheartClassDefinition,
  DaggerheartClassKey,
} from "../types";

export function createPlaceholderDefinition({
  key,
  titlePt,
  titleEn,
  domains = "Fill in this class domains",
}: {
  key: DaggerheartClassKey;
  titlePt: string;
  titleEn: string;
  domains?: string;
}): DaggerheartClassDefinition {
  return {
    key,
    title: {
      "pt-BR": titlePt,
      "en-US": titleEn,
    },
    domains: {
      "pt-BR": domains,
      "en-US": domains,
    },

    classFeature: {
      title: {
        "pt-BR": "Feature da Classe",
        "en-US": "Class Feature",
      },
      description: {
        "pt-BR":
          "Preencha a feature principal desta classe no arquivo de definição correspondente.",
        "en-US":
          "Fill in this class's main feature in the corresponding definition file.",
      },
    },

    backgroundQuestions: {
      "pt-BR": [
        "Pergunta de background 1.",
        "Pergunta de background 2.",
        "Pergunta de background 3.",
      ],
      "en-US": [
        "Background question 1.",
        "Background question 2.",
        "Background question 3.",
      ],
    },

    connectionQuestions: {
      "pt-BR": [
        "Pergunta de conexão 1.",
        "Pergunta de conexão 2.",
        "Pergunta de conexão 3.",
      ],
      "en-US": [
        "Connection question 1.",
        "Connection question 2.",
        "Connection question 3.",
      ],
    },

    startingInventory: {
      fixed: {
        "pt-BR": [],
        "en-US": [],
      },
      choices: {
        "pt-BR": [],
        "en-US": [],
      },
    },

    appearanceSuggestions: {
      "pt-BR": [],
      "en-US": [],
    },

    startingExperiencePlaceholder: {
      "pt-BR": "Trabalhe com o GM para gerar duas experiências iniciais.",
      "en-US": "Work with the GM to create two starting experiences.",
    },
  };
}
