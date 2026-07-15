# Fase 5 — algoritmo de resolução de conflitos

Esta etapa adiciona um algoritmo puro para construir a versão resolvida da ficha sem alterar ainda o IndexedDB, a `syncQueue` ou a interface.

## API

```ts
const plan = buildCharacterConflictResolutionPlan({
  context,
  strategy: "field",
  decisions: {
    "/data/hp_current": "local",
    "/data/inventory": "remote",
  },
});
```

O plano retornado contém:

```ts
{
  strategy,
  decisions,
  baseRevision,
  schemaVersion,
  resolutionPaths,
  remoteSnapshot,
  resolvedSnapshot,
  diff,
  hasChanges,
  operationOutcomes,
  incorporatedQueueRecordIds,
  incorporatedMutationIds,
}
```

`baseRevision` é sempre a `serverRevision` do snapshot remoto que originou o conflito. A futura mutation de resolução deverá usar essa revisão, e não a revisão antiga da mutation rejeitada.

## Construção do resultado

O algoritmo começa por `conflictDetail.serverCharacter`, que é a versão aceita pelo servidor. Em seguida, percorre a mutation conflitante e toda a cauda local ainda não resolvida na ordem da fila.

Para cada operação:

- se o path não cruza nenhuma alteração remota, a operação local é reaplicada;
- se o path pertence a um bloco de resolução escolhido como `local`, a operação é reaplicada;
- se o bloco foi escolhido como `remote`, a operação é descartada e o valor remoto permanece.

Ao final, o serviço calcula novamente:

```ts
createCharacterMutationDiff(remoteSnapshot, resolvedSnapshot)
```

Assim, a futura mutation contém apenas a diferença entre a revisão atual da nuvem e a decisão final do usuário.

## Paths adicionais da cauda

A mutation que recebeu `409` não é necessariamente a única alteração local que pode cruzar mudanças remotas. Autosaves posteriores podem ter sido enfileirados enquanto a primeira requisição estava em trânsito.

`collectCharacterConflictResolutionPaths()` considera:

- os `conflictingPaths` retornados pelo backend;
- qualquer path das mutations posteriores que também intercepte `serverChangedPaths`.

Isso impede que uma mutation ainda não enviada sobrescreva silenciosamente uma mudança remota apenas porque ela não fazia parte da primeira requisição rejeitada.

## Blocos hierárquicos

Quando paths locais conflitantes possuem relação pai/filho, o algoritmo reduz a decisão ao ancestral comum presente nas operações locais.

Exemplo:

```text
/data/detailsPage/story
/data/detailsPage
```

vira uma única decisão para:

```text
/data/detailsPage
```

Dessa forma, não é possível escolher a nuvem para um campo filho e depois reaplicar silenciosamente um `set` local no objeto pai inteiro.

## Estratégias

- `field`: exige uma decisão explícita para cada path de resolução;
- `local`: gera automaticamente decisão `local` para todos os paths;
- `remote`: gera automaticamente decisão `remote` para todos os paths.

`duplicate` não é uma estratégia deste algoritmo. A duplicação será implementada em uma etapa própria porque cria outra ficha local em vez de produzir um snapshot cloud resolvido.

Decisões ausentes, extras ou incompatíveis com a estratégia são rejeitadas.

## Validações de segurança

O serviço recusa a resolução quando:

- o contexto, a ficha, o proprietário ou a cadeia de mutations não coincidem;
- o snapshot remoto foi deletado;
- o dispositivo já conhece uma `serverRevision` posterior ao snapshot do conflito;
- uma escolha de paths é incompleta ou inesperada;
- a combinação escolhida produz um snapshot inválido;
- a mutation final excede os limites do diff incremental.

Mudanças de metadados pertencentes à mesma mutation são aplicadas em lote. Isso permite transições válidas como `daggerheart -> custom` acompanhadas por `classKey -> null`, sem validar um estado intermediário inválido.

## Limites desta etapa

Ainda não são implementados:

- persistência do rascunho das escolhas;
- modal de resolução;
- criação e enfileiramento da mutation final;
- marcação da cadeia antiga como `superseded`;
- descarte local sem mutation quando `hasChanges` for falso;
- atualização do snapshot remoto quando a revisão mudou durante a resolução.
