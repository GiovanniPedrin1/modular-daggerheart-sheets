# Fase 6 — configuração e contratos de segurança

Esta etapa centraliza os parâmetros usados pelas entregas de hardening. A proteção CSRF foi
ativada na etapa 3, o rate limiting na etapa 4 e a auditoria persistente na etapa 6.
O contrato validado evita valores espalhados pelos endpoints e pelo cliente HTTP.

## Identificador de requisição

Toda resposta HTTP recebe o header configurável `X-Request-ID`.

- Um identificador recebido do frontend ou proxy é preservado somente quando contém um token
  ASCII seguro e respeita o limite configurado.
- Valores ausentes, inválidos ou excessivamente longos são substituídos por `req_<uuid>`.
- O header é exposto pelo CORS para que o `ApiClientError.requestId` do frontend possa ser usado
  em suporte e correlação futura de logs.
- O identificador também é devolvido em erros inesperados que escapam da pilha normal de
  middleware.

## Contrato de erro JSON

Erros JSON usam sempre o formato compatível já consumido pelo frontend:

```json
{
  "code": "REQUEST_VALIDATION_FAILED",
  "message": "The request payload or parameters are invalid.",
  "detail": {
    "errors": [],
    "errorCount": 0,
    "truncated": false
  }
}
```

O `requestId` é transportado no header, evitando duplicação e preservando compatibilidade com
os contratos existentes.

Códigos de erro devem ter entre 2 e 64 caracteres e usar somente letras ASCII maiúsculas,
dígitos e `_`. Mensagens vazias são rejeitadas na construção do erro.

Erros de validação não devolvem o valor de entrada nem o contexto interno do Pydantic. Apenas
`location`, `type` e `message` são expostos, com quantidade máxima configurável. Erros 500 usam
mensagem genérica e nunca devolvem texto de exceção, SQL, secrets ou stack trace.

## Limites centralizados

`Settings` passa a concentrar:

- limite global do corpo HTTP;
- limites de backup, ficha cloud e mutation;
- número de operações e paths;
- comprimento e profundidade de paths;
- tamanho de `deviceId`, alvo de share, strings JSON e profundidade JSON;
- retenção e replay de eventos;
- nomes e parâmetros de CSRF;
- políticas de rate limit, janela, Redis, fail-open e leases SSE;
- retenção e minimização de auditoria;
- formato e nível de logs estruturados;
- exposição autenticada de métricas Prometheus.

Existem limites absolutos em `app/core/security_contracts.py`. Uma configuração pode reduzir um
limite em produção, mas não aumentá-lo sem alteração explícita do contrato e revisão de código.

## Validações de startup

A aplicação falha ao carregar configurações incompatíveis, incluindo:

- feature payload maior que o limite global do corpo;
- limites acima do máximo absoluto revisado;
- nomes inválidos de headers ou cookies;
- cookie CSRF com o mesmo nome do cookie de sessão;
- rate limiting habilitado em staging/produção sem storage compartilhado;
- auditoria de IP por hash sem secret independente;
- produção com secret padrão, origem CORS/CSRF não HTTPS, wildcard, CSRF desativado,
  auditoria ou logs estruturados desativados, cookie explicitamente inseguro ou métricas
  habilitadas sem token bearer.

## Compatibilidade das próximas etapas

- **Etapa 2:** concluída; aplica os limites no corpo HTTP, JSON, mutations e identificadores.
- **Etapa 3:** concluída; usa `csrf_*` para validar origem, emitir tokens ligados à sessão e proteger métodos mutáveis.
- **Etapa 4:** concluída; usa `rate_limit_*`, Redis compartilhado fora de desenvolvimento, headers `Retry-After` e leases SSE.
- **Etapa 6:** concluída; usa `audit_*`, `requestId` e uma tabela append-only sem armazenar payloads sensíveis.
- **Etapa 7:** concluída; usa o request ID via context para logs JSON e expõe métricas
  Prometheus com labels de baixa cardinalidade. Veja `phase-6-structured-logging-metrics.md`.
- **Etapa 8:** concluída; separa a janela de replay SSE da janela mais longa de histórico
  compactado por paths. Veja `phase-6-character-event-retention-compaction.md`.


## Character write concurrency

Idempotent owner mutations use bounded PostgreSQL retries configured by
`CHARACTER_WRITE_RETRY_ATTEMPTS`, `CHARACTER_WRITE_RETRY_BASE_DELAY_MS`, and
`CHARACTER_WRITE_RETRY_MAX_DELAY_MS`. The maximum delay must not be lower than the base delay,
and all values are constrained by reviewed absolute caps. See
`phase-6-concurrency-idempotency.md`.
## SSE em produção

A camada realtime possui configurações próprias para timeout de banco, timeout de escrita ASGI,
rotação de conexões, jitter de reconexão, drain de processo e diretiva `retry` do EventSource. Os
valores são validados no startup e possuem máximos absolutos em
`backend/app/core/security_contracts.py`. Consulte
`docs/phase-6-sse-production-hardening.md`.


## Browser boundary additions — version 0.4.10

The browser-facing contract now also centralizes:

- `TRUSTED_HOSTS` for Host header validation;
- explicit `CORS_ALLOWED_HEADERS` and `CORS_MAX_AGE_SECONDS`;
- `API_DOCS_ENABLED`, disabled by default in production;
- cookie prefix, SameSite, path and domain policy;
- global CSP, Referrer-Policy and Permissions-Policy values;
- HSTS enablement, max-age, subdomain and preload controls.

Production startup requires host-only `Path=/` cookies, the effective `__Host-` prefix, security
headers, HSTS, explicit deployment hosts and disabled interactive API documentation. See
`phase-6-cookies-cors-http-headers.md` for deployment guidance.
