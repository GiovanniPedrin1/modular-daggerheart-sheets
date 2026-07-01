import type {
  DaggerheartClassDefinition,
  DaggerheartClassKey,
  LocalizedString,
} from "./types";

export type DaggerheartClassDecoration = {
  classKey: DaggerheartClassKey;
  cssClassName: `dh-decoration-${DaggerheartClassKey}`;
  label: LocalizedString;
  description: LocalizedString;
};

export const decorationByClass: Record<
  DaggerheartClassKey,
  DaggerheartClassDecoration
> = {
  sorcerer: {
    classKey: "sorcerer",
    cssClassName: "dh-decoration-sorcerer",
    label: {
      "pt-BR": "Aura roxa",
      "en-US": "Purple aura",
    },
    description: {
      "pt-BR": "Gradientes roxos laterais e distorção mágica sutil.",
      "en-US": "Side purple gradients and subtle magical distortion.",
    },
  },
  druid: {
    classKey: "druid",
    cssClassName: "dh-decoration-druid",
    label: {
      "pt-BR": "Raízes e folhas",
      "en-US": "Roots and leaves",
    },
    description: {
      "pt-BR": "Bordas orgânicas com raízes, cipós e folhas discretas.",
      "en-US": "Organic borders with subtle roots, vines, and leaves.",
    },
  },
  ranger: {
    classKey: "ranger",
    cssClassName: "dh-decoration-ranger",
    label: {
      "pt-BR": "Galhos e folhagem",
      "en-US": "Branches and foliage",
    },
    description: {
      "pt-BR": "Galhos finos e folhagem lateral com tom naturalista.",
      "en-US": "Thin branches and side foliage with a naturalist tone.",
    },
  },
  warrior: {
    classKey: "warrior",
    cssClassName: "dh-decoration-warrior",
    label: {
      "pt-BR": "Estandartes rasgados",
      "en-US": "Torn banners",
    },
    description: {
      "pt-BR": "Faixas desgastadas e cortes com identidade marcial.",
      "en-US": "Worn bands and cuts with a martial identity.",
    },
  },
  guardian: {
    classKey: "guardian",
    cssClassName: "dh-decoration-guardian",
    label: {
      "pt-BR": "Escudos translúcidos",
      "en-US": "Translucent shields",
    },
    description: {
      "pt-BR": "Formas defensivas translúcidas e brilho protetor suave.",
      "en-US": "Translucent defensive shapes and a soft protective glow.",
    },
  },
  seraph: {
    classKey: "seraph",
    cssClassName: "dh-decoration-seraph",
    label: {
      "pt-BR": "Aura dourada com penas",
      "en-US": "Golden feather aura",
    },
    description: {
      "pt-BR": "Gradiente dourado e pequenas penas nas laterais.",
      "en-US": "Golden gradient and small feathers along the sides.",
    },
  },
  wizard: {
    classKey: "wizard",
    cssClassName: "dh-decoration-wizard",
    label: {
      "pt-BR": "Aura azul estelar",
      "en-US": "Blue stellar aura",
    },
    description: {
      "pt-BR": "Pontos de luz e constelações sutis em azul arcano.",
      "en-US": "Light points and subtle constellations in arcane blue.",
    },
  },
  bard: {
    classKey: "bard",
    cssClassName: "dh-decoration-bard",
    label: {
      "pt-BR": "Ondas sonoras",
      "en-US": "Sound waves",
    },
    description: {
      "pt-BR": "Linhas rítmicas laterais com vibração visual estática.",
      "en-US": "Side rhythmic lines with a static visual vibration.",
    },
  },
  rogue: {
    classKey: "rogue",
    cssClassName: "dh-decoration-rogue",
    label: {
      "pt-BR": "Névoa escura",
      "en-US": "Dark mist",
    },
    description: {
      "pt-BR": "Névoa baixa nas bordas com contraste controlado.",
      "en-US": "Low edge mist with controlled contrast.",
    },
  },
};

export function isDaggerheartClassDecorationKey(
  value?: string | null
): value is DaggerheartClassKey {
  return Boolean(value && value in decorationByClass);
}

export function getDaggerheartClassDecoration(
  classKey?: string | null
): DaggerheartClassDecoration | null {
  if (!isDaggerheartClassDecorationKey(classKey)) {
    return null;
  }

  return decorationByClass[classKey];
}

export function getDaggerheartClassDecorationForDefinition(
  definition?: Pick<DaggerheartClassDefinition, "key"> | null
): DaggerheartClassDecoration | null {
  return getDaggerheartClassDecoration(definition?.key);
}

export function getDaggerheartClassDecorationClassName(
  definition?: Pick<DaggerheartClassDefinition, "key"> | null,
  enabled = true
) {
  if (!enabled) {
    return "";
  }

  return getDaggerheartClassDecorationForDefinition(definition)?.cssClassName ?? "";
}
