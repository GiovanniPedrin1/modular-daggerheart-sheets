# Persistência inicial de conflitos de sincronização

Esta etapa guarda informações suficientes para uma futura UX de resolução de conflito sem ainda exibir uma tela completa.

Quando o worker recebe `SYNC_CONFLICT` do backend, ele agora:

- marca a mutation da `syncQueue` como `conflict`;
- persiste `lastErrorCode` e `lastError`;
- persiste `conflictDetail`, quando o backend retorna o detalhe estruturado;
- marca a ficha local como `syncStatus: "conflict"`;
- avança apenas metadados seguros da ficha, como `serverRevision`, `baseRevision` e `lastSyncedHash`;
- não substitui `name`, `class`, `language` ou `data` locais.

O detalhe persistido segue o contrato `CharacterSyncConflictDetail`:

```ts
{
  characterId: string;
  mutationId: string;
  baseRevision: number;
  serverRevision: number;
  conflictingPaths: string[];
  localOperations: CharacterMutationPatch;
  serverChangedPaths: string[];
  serverCharacter: CloudCharacter;
}
```

A ficha permanece bloqueada para novos autosaves pelo comportamento já existente de `autosaveMutationService`, que não gera mutation quando `syncStatus === "conflict"`.

A resolução visual fica para a próxima fase de UX. Até lá, o registro em conflito preserva o patch local e o snapshot remoto necessário para comparar campo a campo.
