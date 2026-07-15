# Fase 5 — bloqueio de edição durante conflito

Quando uma mutation recebe `SYNC_CONFLICT`, a ficha do dono passa a ser tratada como temporariamente bloqueada para edição até que exista uma decisão explícita de resolução.

## Regras implementadas

- `syncStatus: "conflict"` não é confundido com permissão de viewer. A ficha continua pertencendo ao dono, mas seus dados não podem ser alterados.
- O formulário é renderizado em modo bloqueado, mantendo apenas a navegação entre abas disponível.
- Autosaves agendados para a ficha selecionada são cancelados assim que o estado de conflito chega à interface.
- Novas mudanças do formulário são ignoradas enquanto o conflito estiver ativo.
- Os serviços de persistência local recusam gravação e deleção com `CHARACTER_SYNC_CONFLICT`, evitando bypass da UI.
- O worker de sync solicita uma atualização da lista local depois de processar respostas, para que o bloqueio apareça sem reload.
- A interface exibe uma mensagem específica e o ponto de entrada `Resolver conflito`. Nesta etapa, a ação apenas informa que os dados foram preservados; o fluxo de comparação será implementado nas próximas etapas da Fase 5.

## Separação de conceitos

- `isReadonlyCharacter`: viewer ou registro explicitamente readonly.
- `isConflictLockedCharacter`: owner com conflito pendente.
- `isCharacterEditLocked`: união dos dois casos para operações que alteram a ficha.

Essa separação permite manter ações de proprietário que não editam o conteúdo, como consultar o status ou administrar compartilhamentos, sem permitir novas alterações na ficha.
