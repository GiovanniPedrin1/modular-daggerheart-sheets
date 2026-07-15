# Aplicação segura de respostas de sync

A resposta de uma mutation enviada pela `syncQueue` traz um snapshot cloud completo, mas ele só pode substituir a ficha local quando ainda representa exatamente a edição local que originou a fila.

## Regra de aplicação

Depois de uma resposta `applied` ou `duplicate`, o registro da fila é marcado como `applied` e as mutations posteriores da mesma ficha recebem a `appliedRevision` como nova `baseRevision`.

Em seguida, o `CharacterRecord` é atualizado em uma única transação Dexie junto com a fila:

- Se `character.version === syncQueue.localVersion`, o snapshot retornado pelo servidor pode ser aplicado integralmente. A ficha recebe `name`, `system`, `class`, `language`, `data`, `serverRevision`, `baseRevision`, `lastSyncedHash` e `syncStatus` vindos da resposta.
- Se `character.version > syncQueue.localVersion`, houve edição local mais nova enquanto a requisição estava em trânsito. Nesse caso, o snapshot remoto não sobrescreve campos editáveis locais. Apenas `serverRevision`, `baseRevision`, `lastSyncedHash` e `syncStatus` avançam.
- Se houver mutation posterior ainda não resolvida, a ficha permanece `queued`.
- Se houver mutation posterior em `conflict`, a ficha fica `conflict`.

## Por que `localVersion` é o guardião

O autosave incrementa `CharacterRecord.version` antes de enfileirar a mutation. O registro da fila guarda esse valor em `localVersion`. Quando a resposta volta, comparar os dois valores permite saber se o usuário continuou editando a ficha depois do envio.

Essa regra evita o caso perigoso em que uma resposta atrasada do servidor substitui dados locais mais novos que ainda não foram enviados ou ainda não receberam resposta.

## Limite intencional

A aplicação de atualizações vindas de outro dispositivo ainda não é feita aqui. Esta etapa só aplica respostas das mutations originadas neste dispositivo. Eventos/SSE para o dono e atualização remota segura ficam para a próxima etapa do plano.
