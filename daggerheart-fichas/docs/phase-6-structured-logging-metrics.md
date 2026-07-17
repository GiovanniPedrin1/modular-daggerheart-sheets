# Fase 6 — logs estruturados e métricas

Esta etapa adiciona correlação operacional sem registrar o conteúdo das fichas e sem criar
labels Prometheus de alta cardinalidade.

## Logs JSON

`app/core/observability.py` configura um único formatter JSON. Cada linha contém:

```json
{
  "timestamp": "2026-07-16T01:02:03.456Z",
  "level": "warning",
  "logger": "app.services.character_mutation_transaction_service",
  "event": "character.write.retry",
  "requestId": "req_...",
  "attempt": 1,
  "maxAttempts": 3,
  "reason": "deadlock"
}
```

Eventos implementados incluem:

- `http.request.completed`;
- `http.request.unhandled_error`;
- `security.csrf.rejected`;
- `security.payload.rejected`;
- `security.rate_limit.blocked`, `security.rate_limit.bypassed` e
  `security.rate_limit.unavailable`;
- `character.mutation.completed`;
- `character.write.retry` e `character.write.busy`;
- `character.stream.opened`, `character.stream.closed` e `character.stream.failed`;
- `character.stream.full_resync`;
- `character.share_activation.completed` e `character.share_activation.failed`;
- `application.started` e `application.stopped`.

O formatter não inclui mensagens de exceção por padrão. `LOG_INCLUDE_EXCEPTION_TRACEBACKS=true`
deve ser usado somente em um ambiente controlado, porque tracebacks de dependências podem conter
valores operacionais. Mesmo com essa opção desativada, `exceptionType` permanece disponível.

Chaves cujo nome contém senha, token, cookie, authorization, e-mail, payload, snapshot, patch,
operations, conteúdo, inventário ou história são substituídas por `[redacted]`. Strings e
estruturas também possuem limites de tamanho e profundidade.

## Request middleware

`RequestObservabilityMiddleware` envolve o corpo completo da resposta. Portanto:

- a duração HTTP de SSE mede o tempo até o fechamento do stream;
- o template registrado pelo FastAPI é usado como rota, por exemplo
  `/characters/cloud/{character_id}`;
- uma URL concreta com UUID nunca vira label;
- o tamanho registrado é somente a contagem de bytes, nunca o corpo;
- `/metrics` não contabiliza os próprios scrapes;
- tentativas não autorizadas de consultar `/metrics` ainda geram log de segurança.

O middleware de `X-Request-ID` permanece externo ao middleware de observabilidade, garantindo que
logs de CSRF, payload, rate limit e exceções compartilhem o mesmo identificador retornado ao
cliente.

## Métricas Prometheus

Ative o registry com:

```env
METRICS_ENABLED=true
```

Em produção também é obrigatório:

```env
METRICS_BEARER_TOKEN=<token aleatório com pelo menos 32 caracteres>
```

O scrape é feito em `GET /metrics` usando `Authorization: Bearer <token>`. A resposta possui
`Cache-Control: no-store` e o endpoint não aparece no OpenAPI.

Métricas atuais:

| Métrica | Tipo | Labels |
|---|---|---|
| `daggerheart_build_info` | gauge | `version`, `environment` |
| `daggerheart_http_requests_total` | counter | `method`, `route`, `status_class` |
| `daggerheart_http_request_duration_seconds` | histogram | `method`, `route` |
| `daggerheart_api_errors_total` | counter | `code`, `status` |
| `daggerheart_payload_rejections_total` | counter | `code` |
| `daggerheart_csrf_failures_total` | counter | `reason` |
| `daggerheart_rate_limit_decisions_total` | counter | `policy`, `outcome` |
| `daggerheart_character_mutations_total` | counter | `outcome`, `duplicate`, `merged` |
| `daggerheart_character_mutation_duration_seconds` | histogram | `outcome` |
| `daggerheart_character_write_retries_total` | counter | `reason` |
| `daggerheart_character_write_busy_total` | counter | nenhuma |
| `daggerheart_sse_connections_total` | counter | `role` |
| `daggerheart_sse_connections_active` | gauge | `role` |
| `daggerheart_sse_connection_duration_seconds` | histogram | `role`, `reason` |
| `daggerheart_sse_events_sent_total` | counter | `role`, `event_type` |
| `daggerheart_sse_heartbeats_total` | counter | `role` |
| `daggerheart_character_full_resync_total` | counter | `role`, `reason` |
| `daggerheart_audit_events_staged_total` | counter | `action`, `outcome` |

O registry é local ao processo, como é comum no modelo pull do Prometheus. Cada réplica deve ser
scrapeada separadamente. Redis não é usado para métricas; somar séries entre réplicas é
responsabilidade do Prometheus.

`daggerheart_audit_events_staged_total` mede linhas adicionadas à transação do SQLAlchemy. O nome
`staged` é intencional: uma transação posterior ainda pode sofrer rollback.

## Cardinalidade e privacidade

Nunca usar como label:

- `requestId`;
- `userId`;
- `characterId`;
- `deviceId`;
- `mutationId`;
- e-mail;
- path concreto contendo identificadores;
- texto da ficha ou código de usuário.

Esses valores aumentariam a cardinalidade sem limite e poderiam expor dados pessoais. Para
investigação individual, use o `requestId` apenas nos logs e na resposta HTTP.

## Configuração

```env
STRUCTURED_LOGGING_ENABLED=true
LOG_LEVEL=INFO
LOG_MAX_FIELD_LENGTH=512
LOG_INCLUDE_EXCEPTION_TRACEBACKS=false
LOG_SUCCESSFUL_HTTP_REQUESTS=true
DISABLE_UVICORN_ACCESS_LOG=true
METRICS_ENABLED=false
METRICS_BEARER_TOKEN=
```

Produção exige `STRUCTURED_LOGGING_ENABLED=true`. Se métricas estiverem ativas em produção, o
token bearer também é obrigatório. `LOG_MAX_FIELD_LENGTH` aceita de 64 a 4096 caracteres.

## Alertas iniciais sugeridos

- crescimento de `daggerheart_api_errors_total{code="INTERNAL_SERVER_ERROR"}`;
- crescimento de `daggerheart_csrf_failures_total` após deploy;
- aumento sustentado de `RATE_LIMITED` ou `RATE_LIMIT_UNAVAILABLE`;
- aumento de `daggerheart_character_write_busy_total`;
- proporção elevada de mutation `conflict` ou `rejected`;
- aumento de `daggerheart_character_full_resync_total`;
- queda abrupta de conexões SSE ativas ou crescimento de encerramentos com `reason="error"`;
- p95/p99 de `daggerheart_http_request_duration_seconds` e
  `daggerheart_character_mutation_duration_seconds`.
