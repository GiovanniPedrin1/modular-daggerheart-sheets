export type CreateCharacterShareRequest =
  | {
      targetEmail: string;
      publicUserCode?: never;
    }
  | {
      targetEmail?: never;
      publicUserCode: string;
    };

export type CharacterShareTarget =
  | {
      type: "email";
      label: string;
    }
  | {
      type: "publicUserCode";
      label: string;
    };

export type CharacterShare = {
  id: string;
  characterId: string;
  target: CharacterShareTarget;
  role: "viewer";
  status: "shared";
  createdAt: string;
};

export type CreateCharacterShareResponse = {
  share: CharacterShare;
  created: boolean;
  reason?: "existing_share" | null;
};

export type ListCharacterSharesResponse = {
  shares: CharacterShare[];
};

export type RevokeCharacterShareResponse = {
  ok: true;
  shareId: string;
  characterId: string;
  revokedAt: string;
};

/**
 * Kept as a re-export so imports created while the API contract was drafted do
 * not break. Viewer-specific code should prefer importing from sharedCharacter.
 */
export type {
  GetSharedCharacterResponse,
  ListSharedCharactersResponse,
  SharedCharacter,
  SharedCharacterListItem,
} from "./sharedCharacter";

export const CHARACTER_SHARE_API_ERROR_CODES = {
  cloudCharacterNotFound: "CLOUD_CHARACTER_NOT_FOUND",
  shareNotFound: "CHARACTER_SHARE_NOT_FOUND",
  cannotShareWithSelf: "CANNOT_SHARE_WITH_SELF",
  invalidShareTarget: "INVALID_SHARE_TARGET",
  sharedCharacterNotFound: "SHARED_CHARACTER_NOT_FOUND",
} as const;

export type CharacterShareApiErrorCode =
  (typeof CHARACTER_SHARE_API_ERROR_CODES)[keyof typeof CHARACTER_SHARE_API_ERROR_CODES];

export const PUBLIC_USER_CODE_PATTERN = /^[A-Z0-9-]{6,32}$/;

export class CharacterShareInputError extends Error {
  code:
    | "SHARE_TARGET_REQUIRED"
    | "MULTIPLE_SHARE_TARGETS"
    | "INVALID_TARGET_EMAIL"
    | "INVALID_PUBLIC_USER_CODE";

  constructor(
    code: CharacterShareInputError["code"],
    message: string
  ) {
    super(message);
    this.name = "CharacterShareInputError";
    this.code = code;
  }
}

/**
 * Normalizes a form/runtime value before sending it to the API.
 * TypeScript already prevents both targets in typed callers, but this runtime
 * guard also protects values assembled from uncontrolled form state.
 */
export function normalizeCharacterShareRequest(
  request: CreateCharacterShareRequest
): CreateCharacterShareRequest {
  const rawEmail = "targetEmail" in request ? request.targetEmail : undefined;
  const rawCode =
    "publicUserCode" in request ? request.publicUserCode : undefined;
  const hasEmail = typeof rawEmail === "string" && rawEmail.trim().length > 0;
  const hasCode = typeof rawCode === "string" && rawCode.trim().length > 0;

  if (hasEmail && hasCode) {
    throw new CharacterShareInputError(
      "MULTIPLE_SHARE_TARGETS",
      "Use either an e-mail address or a public user code, not both."
    );
  }

  if (!hasEmail && !hasCode) {
    throw new CharacterShareInputError(
      "SHARE_TARGET_REQUIRED",
      "A share target is required."
    );
  }

  if (hasEmail) {
    const targetEmail = rawEmail!.trim().toLowerCase();
    if (!targetEmail.includes("@")) {
      throw new CharacterShareInputError(
        "INVALID_TARGET_EMAIL",
        "The share e-mail address is invalid."
      );
    }
    return { targetEmail };
  }

  const publicUserCode = rawCode!.trim().toUpperCase();
  if (!PUBLIC_USER_CODE_PATTERN.test(publicUserCode)) {
    throw new CharacterShareInputError(
      "INVALID_PUBLIC_USER_CODE",
      "The public user code is invalid."
    );
  }
  return { publicUserCode };
}
