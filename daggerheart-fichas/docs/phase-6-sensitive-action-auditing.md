# Fase 6 — auditoria de ações sensíveis

Esta etapa adiciona uma trilha de auditoria persistente e minimizada para alterações de estado
relevantes. Auditoria é separada de logs operacionais: o registro é voltado a investigação e
responsabilização, enquanto erros, latência e métricas entram na próxima etapa.

## Armazenamento

A migration `202607090007_create_audit_events.py` cria `audit_events` com:

- ação e resultado estáveis;
- usuário ator e usuário alvo opcionais;
- ficha associada opcional;
- tipo e UUID do recurso;
- `requestId` para correlação;
- `deviceId` quando o protocolo já o fornece;
- IP minimizado conforme configuração;
- User-Agent limitado;
- metadados pequenos e não sensíveis;
- timestamp gerado pelo banco.

As referências a usuário e ficha usam `ON DELETE SET NULL`. Assim, a trilha sobrevive à remoção
posterior do recurso sem impedir o ciclo de vida da conta. Não há endpoint público para consultar
ou alterar auditoria.

## Atomicidade

`append_audit_event()` não executa `commit`. A linha é adicionada à mesma transação da ação de
negócio. Portanto, ficha, mutation, share, backup ou sessão e seu evento de auditoria são
confirmados ou revertidos juntos.

Mutations preservam essa regra dentro de `character_mutation_transaction_service`: a ficha, o
registro de idempotência, o evento SSE e a auditoria pertencem à mesma transação. Retries com o
mesmo `mutationId` não criam uma segunda linha de auditoria.

## Ações registradas

- `auth.registered`
- `auth.login`
- `auth.session_refreshed`
- `auth.logout`
- `backup.created`
- `backup.deleted`
- `character.created`
- `character.snapshot_updated`
- `character.mutation_applied`
- `character.mutation_conflict`
- `character.mutation_rejected`
- `character.deleted`
- `character.share_created`
- `character.share_revoked`
- `character.share_accepted`

Tentativas de login inválidas e acessos negados não são persistidos nesta tabela nesta etapa.
Esses sinais serão cobertos por logs estruturados e métricas sem guardar e-mail ou payload.

## Minimização de dados

A auditoria nunca recebe:

- senha, token, cookie ou header de autorização;
- e-mail ou código público usado como alvo;
- snapshot, payload, patch, operations ou conteúdo da ficha;
- inventário, história, notas ou demais valores do usuário;
- hash completo do conteúdo da ficha.

Metadados aceitam somente estruturas JSON pequenas, com profundidade e tamanho limitados. Chaves
com nomes sensíveis são recusadas antes da persistência. Contagens, revisões, estratégia técnica,
status e códigos estáveis são permitidos.

## IP e User-Agent

`AUDIT_IP_MODE` aceita:

- `none`: não grava IP;
- `truncated`: IPv4 em `/24` e IPv6 em `/48`;
- `hash`: HMAC-SHA256 com `AUDIT_HASH_SECRET` independente do secret de sessão.

O endereço usado é o peer direto fornecido pelo ASGI. A aplicação não confia automaticamente em
`X-Forwarded-For`. Em produção, o proxy/servidor deve expor apenas um endereço já validado.

O User-Agent é normalizado para uma linha e limitado por `AUDIT_USER_AGENT_MAX_LENGTH`.

## Configuração

```env
AUDIT_ENABLED=true
AUDIT_RETENTION_DAYS=90
AUDIT_IP_MODE=none
AUDIT_HASH_SECRET=
AUDIT_USER_AGENT_MAX_LENGTH=256
```

Produção exige `AUDIT_ENABLED=true`. O modo `hash` exige secret próprio, diferente de
`SESSION_SECRET`. `AUDIT_RETENTION_DAYS` define o contrato de retenção; a rotina de expurgo será
conectada na etapa de privacidade e ciclo de vida dos dados.

## Migração

```bash
cd backend
alembic upgrade head
```
