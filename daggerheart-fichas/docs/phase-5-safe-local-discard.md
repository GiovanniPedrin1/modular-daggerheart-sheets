# Fase 5 — descarte local seguro

Esta etapa encerra um conflito sem enviar uma nova mutation quando as escolhas do usuário produzem exatamente o snapshot atual da nuvem.

## Regra de segurança

O descarte só é permitido quando `buildCharacterConflictResolutionPlan()` retorna:

```ts
plan.hasChanges === false
```

Isso significa que o snapshot resolvido é idêntico ao snapshot remoto persistido no `conflictDetail`. Se qualquer alteração local ainda precisar ser preservada — inclusive uma mutation posterior não conflitante — o serviço recusa o descarte com `CHARACTER_CONFLICT_RESOLUTION_DISCARD_REQUIRES_MUTATION`.

## Serviço

`discardCharacterConflictLocalChanges()` relê a ficha e toda a fila dentro de uma transação Dexie envolvendo:

- `characters`;
- `syncQueue`;
- `conflictResolutionDrafts`.

O contexto é reconstruído e o plano é recalculado no momento do commit. Assim, uma revisão remota mais nova, mutation em processamento ou cadeia alterada impede a escrita.

## Alterações atômicas

Quando o descarte é válido, a transação:

1. substitui o conteúdo local pelo snapshot remoto persistido;
2. avança `serverRevision` e `baseRevision` para a revisão do conflito;
3. atualiza `lastSyncedHash`;
4. muda a ficha de `conflict` para `synced`;
5. marca a mutation conflitante e toda a cauda incorporada como `superseded`;
6. registra estratégia, decisões e `resolvedAt`;
7. não define `supersededByMutationId`, pois nenhuma mutation sucessora existe;
8. exclui o rascunho das escolhas.

Se qualquer operação falhar, o conflito permanece intacto.

## Interface

Quando o plano não possui alterações, o modal:

- explica que nenhuma mutation será enviada;
- troca a ação principal para **Descartar alterações locais**;
- usa aparência de ação destrutiva;
- aguarda salvamentos pendentes do rascunho antes do commit;
- recarrega a ficha após a conclusão.

O worker é notificado depois da transação para que a remoção do bloqueio da fila seja observada imediatamente.
