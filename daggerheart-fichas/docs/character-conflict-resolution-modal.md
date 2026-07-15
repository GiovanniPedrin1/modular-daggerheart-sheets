# Modal de resolução de conflito

Esta etapa conecta o bloqueio da ficha ao contexto de conflito persistido no IndexedDB. O botão **Resolver conflito** abre um modal local; nenhuma chamada de rede é necessária para revisar ou salvar escolhas.

## Carregamento

O modal usa `readCharacterConflictResolutionContext()` para validar a ficha, a mutation conflitante e a cauda ainda não resolvida. Em seguida:

1. calcula todos os paths que precisam de decisão com `collectCharacterConflictResolutionPaths()`;
2. cria labels, grupos e valores legíveis com `presentCharacterConflictPaths()`;
3. recupera o rascunho atual em `conflictResolutionDrafts`;
4. restaura estratégia e escolhas quando a identidade do rascunho ainda corresponde ao conflito.

O serviço de apresentação agora aceita uma lista explícita de paths. Isso permite mostrar também conflitos descobertos em mutations posteriores, não apenas os `conflictingPaths` do primeiro `409`.

## Escolhas

O usuário pode:

- escolher `local` ou `remote` em cada path;
- preencher todos os paths com a versão local;
- preencher todos os paths com a versão da nuvem;
- voltar ao modo campo a campo sem perder escolhas já feitas.

Valores simples aparecem como texto. Objetos e arrays aparecem como JSON formatado e são marcados como blocos complexos. Sobreposição entre path pai e filho também recebe aviso explícito.

## Persistência

Cada alteração é enfileirada em uma cadeia de Promises antes de chamar `saveCharacterConflictResolutionDraft()`. Isso evita que respostas assíncronas fora de ordem façam uma escolha antiga sobrescrever a mais recente.

O fechamento do modal não cancela uma gravação já iniciada. O rascunho continua sendo persistido, embora atualizações de estado React sejam ignoradas após o unmount.

## Revisão remota mais nova

Quando `hasNewerKnownServerRevision` está ativo, o modal mostra o snapshot do conflito apenas para consulta e desabilita todas as escolhas. Ele não tenta aplicar um rascunho a valores possivelmente desatualizados. A atualização da comparação será tratada na etapa específica de mudança da nuvem durante a resolução.

## Confirmação

Quando todos os paths possuem decisão e o plano gera alterações, o botão **Confirmar e sincronizar** chama `enqueueCharacterConflictResolutionMutation()`.

O modal aguarda a cadeia de salvamentos do rascunho antes do commit. Durante a confirmação, escolhas e botões de fechamento ficam bloqueados. Depois da transação local, a lista de fichas é recarregada e o worker recebe a notificação da nova mutation.

Quando as escolhas resultam exatamente no snapshot remoto, a ação principal muda para **Descartar alterações locais**. O modal chama o serviço de descarte seguro, que encerra o conflito sem criar ou enviar uma mutation.
