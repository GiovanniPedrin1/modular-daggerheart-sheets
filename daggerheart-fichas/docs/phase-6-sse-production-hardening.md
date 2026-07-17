# Fase 6 — hardening de SSE para produção

## Objetivo

Manter os streams de fichas previsíveis atrás de proxies e durante deploys, sem deixar conexões,
sessões de banco ou leases de rate limiting presas indefinidamente.

## Contrato de transporte

Os endpoints permanecem:

```text
GET /shared/characters/{characterId}/events
GET /characters/cloud/{characterId}/events
```

O cliente informa `sinceRevision` na primeira conexão. Depois de receber um evento com `id`, o
`EventSource` nativo envia `Last-Event-ID` automaticamente nas reconexões.

A primeira frame de uma conexão longa contém:

```text
retry: 3000
```

Ela configura o atraso de reconexão do navegador e não altera o cursor. Heartbeats e avisos de
rotação também são comentários SSE, portanto nunca substituem o último `eventId` persistido.

## Rotação de conexões

Cada stream possui duração limitada por:

```env
CHARACTER_EVENT_STREAM_MAX_DURATION_SECONDS=300
CHARACTER_EVENT_STREAM_ROTATION_JITTER_SECONDS=30
```

Ao atingir o prazo, o servidor envia um comentário `: reconnect rotation` e encerra a resposta. O
jitter evita que todas as abas reconectem no mesmo segundo. A rotação limita a vida de conexões em
workers antigos e facilita deploys graduais e redistribuição entre réplicas.

## Timeouts

```env
CHARACTER_EVENT_QUERY_TIMEOUT_SECONDS=5
CHARACTER_EVENT_SEND_TIMEOUT_SECONDS=10
```

- O timeout de consulta cobre replay, polling e revalidação de acesso.
- O timeout de escrita cobre o envio ASGI para um cliente ou proxy lento.
- Em ambos os casos a conexão é encerrada; o `EventSource` reconecta usando o mesmo cursor.
- Nenhuma sessão SQLAlchemy fica aberta entre polls.

## Heartbeat e revogação

```env
CHARACTER_EVENT_POLL_INTERVAL_SECONDS=1
CHARACTER_EVENT_HEARTBEAT_SECONDS=15
CHARACTER_EVENT_ACCESS_RECHECK_SECONDS=5
```

O heartbeat mantém o caminho HTTP ativo em balanceadores e proxies. A autorização é revalidada em
intervalos curtos. Eventos `deleted` e `share_revoked` continuam terminais e encerram o stream logo
após serem entregues.

## Drain e encerramento

```env
CHARACTER_EVENT_SHUTDOWN_GRACE_SECONDS=15
```

O processo rejeita novas conexões com `503 EVENT_STREAM_DRAINING`, sinaliza streams rastreados e
aguarda o drain local pelo período configurado. A rotação periódica continua sendo a garantia
principal porque alguns servidores ASGI iniciam o teardown de lifespan somente depois de cancelar
as tarefas HTTP.

No Uvicorn/Kubernetes, configure o graceful shutdown para um valor maior que o grace da aplicação.
Um `preStop` deve retirar o pod do balanceador antes do `SIGTERM`.

## Headers e proxy

O backend envia:

```text
Cache-Control: no-cache, no-store, private, no-transform
Pragma: no-cache
Expires: 0
X-Accel-Buffering: no
X-Content-Type-Options: nosniff
Content-Encoding: identity
```

O header hop-by-hop `Connection` não é enviado, pois é inválido em HTTP/2.

Exemplo Nginx para as rotas SSE:

```nginx
location ~ ^/(shared/characters|characters/cloud)/[^/]+/events$ {
    proxy_pass http://daggerheart_backend;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 90s;
    proxy_send_timeout 30s;
}
```

O `proxy_read_timeout` deve ser maior que o heartbeat. CDN ou plataforma serverless que imponha um
limite inferior à duração do stream deve usar uma duração de rotação menor que esse limite.

## Rate limiting

A lease de conexão SSE agora é renovada por uma tarefa independente da produção de frames. Assim,
um poll lento ou intervalo sem eventos não permite que a lease expire prematuramente. O TTL no
Redis ainda remove leases após encerramento abrupto do processo.

## Observabilidade

Além das métricas de conexões, duração, eventos e heartbeats, foi adicionada:

```text
daggerheart_sse_transport_failures_total{reason="..."}
```

Razões esperadas incluem:

```text
rotation
server_shutdown
send_timeout
database_timeout
prepare_timeout
lease_refresh_failed
```

Logs estruturados relevantes:

```text
character.stream.opened
character.stream.closed
character.stream.database_timeout
character.stream.send_timeout
character.stream.prepare_timeout
character.stream.lease_refresh_failed
character.stream.drain_started
character.stream.drain_completed
```

## Critérios de aceite

- Heartbeats atravessam o proxy sem buffering.
- O navegador reconecta após rotação mantendo o último `eventId`.
- Uma escrita ASGI bloqueada não prende a tarefa indefinidamente.
- Consultas travadas encerram o stream dentro do timeout.
- Leases SSE são renovadas mesmo sem frames de aplicação.
- Novas conexões recebem `503` durante drain.
- Revogação e deleção encerram o stream após o evento terminal.
- Métricas não usam IDs de usuário, ficha ou dispositivo como labels.
