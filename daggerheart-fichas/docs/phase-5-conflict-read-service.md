# Fase 5 — serviço de leitura do conflito

Esta etapa adiciona uma camada somente de leitura entre a UI futura e os registros brutos do IndexedDB. O objetivo é impedir que a tela de resolução tente interpretar diretamente uma fila incompleta, ambígua ou corrompida.

## API

```ts
readCharacterConflictResolutionContext({
  characterId,
  ownerUserId,
});
```

O resultado contém:

```ts
{
  character,
  conflictMutation,
  conflictDetail,
  followingMutations,
  mutationChain,
  hasNewerKnownServerRevision,
}
```

- `conflictMutation` é a única mutation ativa com status `conflict`;
- `followingMutations` contém apenas mutations posteriores ainda não resolvidas;
- `mutationChain` começa pela mutation conflitante e inclui a cauda que uma resolução futura deverá incorporar ou substituir;
- registros `applied` e `superseded` são ignorados;
- `hasNewerKnownServerRevision` informa que o dispositivo recebeu notícia de uma revisão posterior ao snapshot guardado no conflito.

## Validações

O serviço recusa a leitura quando:

- a ficha não pertence ao usuário autenticado ou não está bloqueada por conflito;
- não existe exatamente uma mutation conflitante ativa;
- há uma mutation não resolvida ordenada antes do conflito;
- uma mutation posterior ainda está em `syncing`;
- a identidade local, `remoteId` ou proprietário da fila não coincide com a ficha;
- o envelope da mutation não passa pelas validações normais de `toCharacterMutationRequest()`;
- `conflictDetail` não coincide com a mutation persistida;
- os paths conflitantes não representam exatamente a interseção entre paths locais e remotos;
- o snapshot remoto não coincide com personagem, proprietário, revisão e schema do conflito.

A leitura não altera a ficha nem a fila. O contexto retornado é clonado para evitar que componentes modifiquem acidentalmente objetos recuperados do Dexie.

## Limites desta etapa

Ainda não são criados:

- nomes legíveis para os paths;
- classificação entre valores simples e blocos complexos;
- rascunho de escolhas local/nuvem;
- algoritmo que constrói o snapshot resolvido;
- modal de resolução.
