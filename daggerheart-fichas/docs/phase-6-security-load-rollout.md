# Fase 6 — testes de segurança, carga e rollout

Esta etapa fecha o hardening com três gates independentes: regressão automatizada, smoke tests
não destrutivos contra o deploy e rollout controlado com rollback por funcionalidade.

## Gates de CI

O workflow `.github/workflows/ci.yml` executa:

1. frontend: typecheck, lint, Vitest e build/PWA;
2. backend: Ruff, suíte unitária e marcador `security`;
3. PostgreSQL real: migrations e testes concorrentes marcados com `postgres`;
4. readiness com PostgreSQL, Redis e Alembic no head;
5. smoke de segurança contra Uvicorn real;
6. carga HTTP limitada e somente leitura;
7. Playwright Chromium para os fluxos E2E.

Nenhum deploy deve ignorar um job vermelho. Os testes PostgreSQL usam somente banco descartável.

## Release readiness

Antes de promover uma imagem:

```bash
cd backend
check-release-readiness --pretty
```

O comando valida:

- contrato completo de `Settings`;
- ambiente e revisão do release;
- conexão PostgreSQL;
- igualdade entre `alembic_version` e o head da aplicação;
- Redis quando rate limiting está ativo;
- estado dos switches de rollout.

Warnings não bloqueiam o comando. Falhas de banco, migration ou Redis retornam código de saída 1.
O relatório nunca inclui URLs, credenciais ou mensagens internas de conexão.

Para validar somente a configuração durante o build:

```bash
check-release-readiness --skip-database --skip-rate-limit --pretty
```

## Smoke de segurança

Use somente contra ambientes controlados pelo projeto:

```bash
security-smoke-test \
  --base-url https://api.example.com \
  --trusted-origin https://app.example.com \
  --expected-host api.example.com \
  --require-hsts \
  --expect-docs-disabled \
  --pretty
```

O smoke é não destrutivo. Ele verifica health, `X-Request-ID`, headers de segurança, bloqueio de
`Host`, preflight CORS, rejeição de origem CSRF, documentação desativada e proteção de `/metrics`.

## Carga limitada

O harness usa GET e não altera estado:

```bash
load-smoke-test \
  --base-url https://api.example.com \
  --path /health \
  --requests 1000 \
  --concurrency 50 \
  --max-error-rate 0.01 \
  --max-p95-ms 500 \
  --min-rps 20 \
  --pretty
```

A saída contém RPS, taxa de erro, média, p50, p95, p99 e contagem por status. O comando falha
quando qualquer threshold é ultrapassado. Para endpoints protegidos, headers podem ser passados
com `--header 'Authorization: Bearer ...'`; nunca grave tokens no repositório ou nos logs de CI.

O smoke não substitui um teste de capacidade longo. Antes de ampliar o rollout, execute em staging:

- mutations pequenas e concorrentes contra contas descartáveis;
- muitas conexões SSE e uma onda de reconexão;
- payloads próximos aos limites;
- retenção/compactação durante tráfego;
- indisponibilidade e recuperação de Redis/PostgreSQL.

## Switches de rollout

As leituras permanecem disponíveis. Os caminhos de maior risco podem ser pausados separadamente:

```env
CLOUD_SNAPSHOT_WRITES_ENABLED=true
CLOUD_MUTATIONS_ENABLED=true
CHARACTER_SHARING_WRITES_ENABLED=true
CHARACTER_SSE_ENABLED=true
ROLLOUT_RETRY_AFTER_SECONDS=60
RELEASE_REVISION=<git-sha-ou-digest-da-imagem>
```

Quando um switch está desligado, o endpoint retorna `503 FEATURE_TEMPORARILY_DISABLED` e
`Retry-After`. A `syncQueue` mantém a mesma mutation e tenta novamente sem perder idempotência.

Ordem recomendada de canary:

1. deploy com mutations, sharing e SSE desativados;
2. validar health, readiness, migrations, logs e métricas;
3. habilitar snapshots para equipe interna;
4. habilitar mutations para pequena porcentagem de contas;
5. habilitar sharing;
6. habilitar SSE por último;
7. expandir gradualmente após uma janela sem alertas.

O targeting por porcentagem deve ser feito na camada de deployment/configuração. Os switches do
backend são kill switches globais e deliberadamente simples.

## Sinais de rollback

Pause primeiro o componente afetado quando houver:

- aumento sustentado de `SYNC_CONFLICT`, `REVISION_NOT_AVAILABLE` ou `CHARACTER_WRITE_BUSY`;
- p95 acima do orçamento ou taxa de erro acima de 1%;
- desconexões/reconexões SSE em massa;
- fila de mutations crescendo sem drenagem;
- `CSRF_FAILED` ou `RATE_LIMITED` acima do baseline esperado;
- migrations divergentes ou Redis indisponível;
- perda, duplicação ou sobrescrita de conteúdo confirmada.

Rollback operacional:

1. desligar o switch específico;
2. manter leituras e downloads disponíveis;
3. preservar filas locais e registros de idempotência;
4. interromper expansão do canary;
5. coletar `requestId`, métricas e auditoria sem conteúdo da ficha;
6. reverter a imagem somente depois de confirmar compatibilidade de migration;
7. reexecutar readiness, security smoke, load smoke e E2E antes de reabrir.

Nunca faça downgrade destrutivo de migration durante o incidente. Prefira código compatível com o
schema mais novo e uma migration corretiva posterior.

## Critério de saída da Fase 6

A fase está pronta para produção quando todos os jobs do CI passam, staging executa migrations e
readiness sem falhas, os thresholds de carga são atendidos, alertas estão configurados e o rollback
por switch foi ensaiado pelo menos uma vez.
