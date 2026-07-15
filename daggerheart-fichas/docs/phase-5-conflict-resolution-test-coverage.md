# Cobertura de testes da resolução de conflitos

Esta etapa fecha a Fase 5 com cobertura de componente, integração entre serviços e fluxos E2E no navegador.

## Testes de componente

`tests/frontend/CharacterConflictResolutionModal.test.tsx` cobre, além dos cenários anteriores:

- recuperação automática de escolhas a partir da cadeia de mutations `superseded` quando não há rascunho atual;
- preservação do modal, das escolhas e do conflito quando o commit da resolução falha;
- garantia de que `onResolved` só é chamado depois de uma conclusão bem-sucedida.

## Teste de integração

`tests/frontend/characterConflictResolutionWorkflow.integration.test.ts` executa um fluxo completo com repositórios em memória, usando os serviços reais:

1. lê o conflito persistido e sua cauda de mutations;
2. salva uma escolha parcial;
3. recebe uma revisão cloud mais nova;
4. atualiza o conflito e migra o rascunho;
5. preserva a escolha ainda compatível e exige decisão para o novo path;
6. cria uma resolução mista;
7. marca a cadeia antiga como `superseded`;
8. enfileira a mutation sucessora baseada na revisão cloud atual;
9. drena a fila e aplica a resposta do servidor;
10. confirma que a ficha termina `synced` sem perder alterações locais ou remotas.

## Testes E2E

`e2e/owner-sync.spec.ts` cobre sete cenários do proprietário:

- autosave gera e drena uma mutation;
- `SYNC_CONFLICT` preserva a edição local, bloqueia a ficha e a resolução local cria uma mutation sucessora;
- escolha integral da nuvem faz descarte local sem segundo `PATCH`;
- duplicação preserva a versão local e restaura a ficha cloud;
- resolução mista mantém um campo local e outro remoto;
- rascunho sobrevive ao fechamento e reload;
- atualização cloud durante o modal exige refresh, preserva escolhas compatíveis e sincroniza sobre a nova revisão.

Os dois cenários existentes de viewer em `e2e/shared-characters.spec.ts` também continuam cobertos, incluindo leitura sem persistência e acesso revogado.

Os E2E usam a aplicação real no navegador, IndexedDB/Dexie, hooks de autosave, `syncQueue`, worker de drenagem e modal. Somente HTTP e EventSource são controlados pelo teste.

## Correção encontrada pelos E2E

O primeiro teste em navegador revelou que o stream SSE falhava quando `VITE_API_BASE_URL` era relativo, como `/api`. `buildCharacterEventStreamUrl()` agora resolve a URL contra `window.location.origin`, mantendo suporte tanto a bases relativas quanto absolutas.

## Comandos

```bash
npm run typecheck
npm run lint
npx vitest run tests/frontend --maxWorkers=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  npx playwright test --workers=2 --retries=0
npm run build:check
```

Sem um Chromium do sistema, instale o navegador gerenciado pelo Playwright:

```bash
npm run test:e2e:install
npm run test:e2e
```

Em ambientes com pouca memória, a suíte Vitest pode ser dividida por arquivo ou por grupos mantendo `--maxWorkers=1`.
