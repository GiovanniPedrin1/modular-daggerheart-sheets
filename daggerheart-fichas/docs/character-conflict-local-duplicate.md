# Duplicação local durante a resolução de conflito

A estratégia `duplicate` preserva a versão completa existente no dispositivo sem tentar enviá-la para a ficha cloud que entrou em conflito.

## Resultado da operação

A confirmação é executada em uma única transação Dexie:

1. A ficha local em conflito é copiada para um novo `CharacterRecord`.
2. A cópia recebe um novo `id`, não possui `remoteId`, revisões de servidor ou `ownerUserId`, e inicia com `syncStatus: "local"`.
3. O nome recebe o sufixo localizado `(cópia local)` ou `(local copy)` para diferenciá-la da ficha cloud.
4. A ficha original é restaurada a partir de `conflictDetail.serverCharacter` e volta para `syncStatus: "synced"`.
5. A mutation conflitante e sua cauda são marcadas como `superseded`, com `resolutionStrategy: "duplicate"` e sem mutation sucessora.
6. O rascunho de resolução é removido.

Nenhum `PATCH` é enviado ao backend.

## Garantias de segurança

- O contexto do conflito é relido dentro da transação antes de gravar qualquer alteração.
- A operação é recusada se o dispositivo já conhece uma revisão de servidor posterior ao snapshot persistido no conflito.
- A cópia usa `add`, não `put`, para impedir sobrescrita caso o novo identificador colida.
- A ficha cloud e a cópia local são gravadas atomicamente com o encerramento da fila.
- A cópia preserva todos os dados locais atuais, inclusive mutations posteriores incorporadas ao estado da ficha.

## Interface

O modal oferece a estratégia **Duplicar versão local**. Nessa estratégia, escolhas campo a campo ficam desabilitadas porque toda a versão local é preservada como uma ficha independente. A ação principal passa a ser **Duplicar e manter nuvem**.
