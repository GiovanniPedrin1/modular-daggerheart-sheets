# Fase 5 — persistência do rascunho de resolução

A resolução de conflito pode levar vários minutos. Fechar o modal, trocar de rota ou
recarregar o aplicativo não deve apagar as escolhas já feitas pelo usuário.

## Armazenamento local

A versão 5 do IndexedDB adiciona a tabela `conflictResolutionDrafts`. Ela usa o id
local da ficha como chave primária, portanto existe no máximo um rascunho ativo por
ficha.

Cada registro guarda:

- ficha local, ficha cloud e proprietário;
- mutation que iniciou o conflito;
- revisão e versão de schema do snapshot remoto;
- cadeia de mutations locais incorporada pela resolução;
- paths que exigem decisão;
- estratégia (`field`, `local`, `remote` ou `duplicate`);
- escolhas parciais por path;
- timestamps de criação e última atualização.

O rascunho fica separado da `syncQueue`. Os campos `resolutionStrategy` e
`resolutionDecisions` da fila continuam representando apenas a decisão final de uma
mutation já marcada como `superseded`.

## Regras

- A estratégia `field` aceita escolhas parciais.
- `local` e `remote` expandem automaticamente a escolha para todos os paths.
- `duplicate` não armazena escolhas por path.
- Paths que não pertencem ao conflito atual são recusados.
- Atualizar o mesmo conflito preserva `createdAt` e avança `updatedAt`.
- A leitura devolve cópias dos dados para impedir mutação acidental do registro Dexie.

## Rascunhos desatualizados

O rascunho inclui a revisão remota, a cadeia de mutation ids e os paths esperados.
Se o contexto mudar, `inspectCharacterConflictResolutionDraft()` informa os campos
divergentes sem apagar o rascunho. Isso preserva as escolhas para a etapa futura que
tratará uma nova atualização da nuvem durante a resolução.

`loadCharacterConflictResolutionDraft()` é a leitura estrita: ela retorna apenas um
rascunho que ainda corresponde exatamente ao conflito atual e lança
`STALE_CHARACTER_CONFLICT_RESOLUTION_DRAFT` nos demais casos.
