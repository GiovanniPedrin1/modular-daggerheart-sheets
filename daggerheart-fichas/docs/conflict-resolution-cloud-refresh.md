# Atualização da nuvem durante a resolução de conflito

Quando o SSE informa uma revisão posterior à armazenada no `conflictDetail`, o modal bloqueia a confirmação e oferece **Atualizar comparação**.

O refresh busca o snapshot atual com `GET /characters/cloud/{id}` e, em uma transação Dexie:

- mantém os dados locais bloqueados;
- substitui apenas o snapshot remoto e a revisão do conflito;
- acumula os paths alterados no servidor;
- recalcula os paths que precisam de decisão;
- migra o rascunho, preservando apenas escolhas cujo path continua com a mesma abrangência;
- deixa novos paths sem escolha para evitar aplicar uma decisão antiga a dados que o usuário ainda não viu.

Se uma mutation de resolução receber outro `409 SYNC_CONFLICT`, as mutations anteriores continuam `superseded` com `resolutionDecisions`. Ao abrir o novo conflito, o serviço de recuperação recria um rascunho e reaplica as escolhas que ainda correspondem exatamente aos novos paths.

Snapshots retornados com revisão inferior à revisão já conhecida localmente são recusados. A ficha permanece em conflito e nenhum dado local é sobrescrito.
