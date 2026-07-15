# Fase 5 — enfileirar a mutation de resolução

Esta etapa conecta a confirmação do modal ao algoritmo de resolução e à `syncQueue`. A resolução não reaproveita a mutation que recebeu `409`: ela cria uma nova mutation baseada no snapshot remoto atual e encerra a cadeia antiga como `superseded`.

## Serviço de commit

`enqueueCharacterConflictResolutionMutation()` executa o fluxo completo em uma única transação Dexie envolvendo:

- `characters`;
- `syncQueue`;
- `conflictResolutionDrafts`.

Antes de gravar, o serviço relê a ficha e toda a fila dentro da transação. O contexto é reconstruído com `buildCharacterConflictResolutionContext()` e o plano é recalculado com `buildCharacterConflictResolutionPlan()`. Assim, uma confirmação baseada em conflito alterado, mutation ativa ou revisão remota mais nova é recusada sem escrita parcial.

## Mutation sucessora

Quando o plano possui alterações, a nova mutation usa:

```ts
{
  baseRevision: conflictDetail.serverRevision,
  operations: plan.diff.operations,
  changedPaths: plan.diff.changedPaths,
  localVersion: resolvedCharacter.version,
}
```

O `mutationId` e o ID do registro da fila são novos. O `deviceId` é o identificador persistido do dispositivo atual.

A ficha local passa a representar imediatamente o snapshot resolvido:

- preserva alterações remotas fora do conflito;
- aplica as escolhas locais selecionadas;
- avança `version` local;
- mantém `serverRevision` e `baseRevision` na revisão usada como base;
- muda de `conflict` para `queued`.

Isso desbloqueia a edição sem fingir que a resolução já foi aceita pelo servidor.

## Encerramento da cadeia antiga

A mutation conflitante e todas as mutations posteriores incorporadas ao plano são transformadas em `superseded`. Cada registro mantém seu payload original e recebe:

```ts
{
  resolutionStrategy,
  resolutionDecisions,
  resolvedAt,
  supersededByMutationId,
}
```

A nova mutation é adicionada somente dentro da mesma transação. Se qualquer gravação falhar, a ficha continua em conflito e a cadeia anterior não é encerrada parcialmente.

## Rascunho e worker

O rascunho de escolhas é excluído na mesma transação. Depois do commit, `notifySyncQueueChanged()` acorda o worker, que pode enviar a mutation sucessora imediatamente quando houver conexão e sessão válidas.

O modal aguarda qualquer salvamento de rascunho já iniciado antes de confirmar. Isso impede que uma gravação atrasada recrie um rascunho obsoleto depois do commit.

## Caso sem mutation

Se o resultado resolvido for idêntico ao snapshot remoto, nenhuma mutation é enviada. O modal direciona a confirmação para `discardCharacterConflictLocalChanges()`, que restaura o snapshot da nuvem, encerra a cadeia antiga como `superseded` e remove o rascunho na mesma transação.
