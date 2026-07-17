# Fase 6 — rate limiting

Esta etapa adiciona limitação de frequência distribuída para autenticação, leituras, escritas,
compartilhamento, mutations e conexões SSE. O objetivo é reduzir abuso sem quebrar retries
idempotentes nem transformar uma ficha específica em bloqueio global para toda a conta.

## Armazenamento

- Desenvolvimento e testes podem usar o armazenamento em memória do processo quando
  `RATE_LIMIT_STORAGE_URL` estiver vazio.
- Staging e produção exigem Redis quando `RATE_LIMIT_ENABLED=true`, porque contadores locais não
  são compartilhados entre réplicas.
- Chaves usam HMAC-SHA256. E-mail, usuário, dispositivo, IP e ficha não são gravados em claro no
  Redis.
- Contadores usam janela com expiração atômica. Leases SSE usam sorted sets com expiração e
  renovação periódica.

Exemplo:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_STORAGE_URL=redis://localhost:6379/0
RATE_LIMIT_KEY_PREFIX=daggerheart
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_SSE_LEASE_SECONDS=90
RATE_LIMIT_FAIL_OPEN=true
```

`RATE_LIMIT_FAIL_OPEN=true` mantém a API disponível quando o Redis falha. Com `false`, a API
retorna `503 RATE_LIMIT_UNAVAILABLE`. A escolha deve ser explícita conforme a tolerância do
ambiente.

## Políticas

| Fluxo | Chaves |
|---|---|
| Cadastro e login | IP e e-mail normalizado, em buckets independentes |
| Leituras autenticadas | usuário |
| Escritas gerais | usuário |
| Compartilhar/revogar | usuário e usuário + ficha |
| PATCH/delete de ficha | usuário, usuário + ficha e usuário + ficha + dispositivo |
| SSE | conexões simultâneas por usuário e por ficha |

Os limites são configurados por:

```env
RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_SHARE_PER_MINUTE=20
RATE_LIMIT_MUTATION_PER_MINUTE=120
RATE_LIMIT_READ_PER_MINUTE=300
RATE_LIMIT_SSE_CONNECTIONS_PER_USER=10
RATE_LIMIT_SSE_CONNECTIONS_PER_CHARACTER=5
```

A identificação do cliente usa `request.client.host`. O backend não confia diretamente em
`X-Forwarded-For`; a configuração de proxy confiável será revisada junto ao deploy e aos headers
HTTP na etapa 11.

## Contrato HTTP

Uma rejeição usa:

```json
{
  "code": "RATE_LIMITED",
  "message": "Too many requests. Please retry later.",
  "detail": {
    "policy": "mutation_character",
    "limit": 120,
    "retryAfterSeconds": 42
  }
}
```

Com status `429` e headers:

```http
Retry-After: 42
RateLimit-Limit: 120
RateLimit-Remaining: 0
RateLimit-Reset: 42
```

Respostas aceitas também podem incluir `RateLimit-Limit`, `RateLimit-Remaining` e
`RateLimit-Reset`. Esses headers e `Retry-After` são expostos no CORS.

## Worker da syncQueue

`ApiClientError` agora converte `Retry-After` em `retryAfterMs`. Em um `429`, o worker escolhe o
maior valor entre o backoff exponencial local e o atraso informado pelo servidor. O mesmo
`mutationId` é preservado no retry, mantendo a idempotência.

## SSE

Uma conexão autorizada adquire duas leases: uma por usuário e outra por ficha. A lease é
renovada durante o stream e removida no `finally`. Caso o processo caia, a expiração libera a
vaga automaticamente. Revogação, deleção e desconexão continuam encerrando o stream pelo fluxo
existente.

Respostas `full_resync_required`, que são finitas, não ocupam uma lease de conexão longa.

## Rollout

1. Habilitar Redis e `RATE_LIMIT_ENABLED=true` em staging.
2. Observar `429`, retries e conexões SSE antes de reduzir limites.
3. Habilitar gradualmente em produção.
4. Ajustar limites somente por configuração; mudanças de estratégia exigem revisão de código.

Logs e métricas específicos de rate limit entram na etapa 7. Testes distribuídos e carga entram
na etapa 12.
