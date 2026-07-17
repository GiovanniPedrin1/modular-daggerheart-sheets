# Fase 6 — privacidade e ciclo de vida dos dados

Esta etapa define quais dados permanecem ativos, quais viram registros temporários e quando podem
ser removidos definitivamente. A rotina é conservadora: **fichas ativas, compartilhamentos ativos
e backups manuais nunca são apagados pelo job de manutenção**.

## Política implementada

| Dado | Estado ativo | Retenção após ficar inativo | Ação |
|---|---|---:|---|
| Ficha cloud | `deleted_at IS NULL` | 30 dias como tombstone | hard delete com cascade |
| Convite por e-mail | `pending` | 30 dias sem aceite | delete, removendo o e-mail alvo |
| Compartilhamento revogado | `revoked` | 30 dias | delete |
| Sessão expirada/revogada | ativa até expiração/revogação | 7 dias | delete do hash, deviceId e User-Agent |
| Auditoria | append-only | 90 dias | delete por retenção |
| Backup manual | criado pelo usuário | até exclusão manual ou limite por quantidade | não entra no job |
| Compartilhamento ativo | `active` | enquanto autorizado | não entra no job |

Os valores são configuráveis:

```env
CLOUD_CHARACTER_TOMBSTONE_RETENTION_DAYS=30
PENDING_SHARE_RETENTION_DAYS=30
REVOKED_SHARE_RETENTION_DAYS=30
REFRESH_SESSION_RETENTION_DAYS=7
AUDIT_RETENTION_DAYS=90
DATA_LIFECYCLE_BATCH_SIZE=500
```

Nenhum período pode exceder 3.650 dias sem mudança explícita do contrato de segurança. O batch é
limitado a 10.000 registros por categoria.

## Job de manutenção

Execute primeiro em modo de inspeção:

```bash
maintain-data-lifecycle --dry-run
```

Depois execute a remoção:

```bash
maintain-data-lifecycle
```

O comando aceita `--now` para testes e `--batch-size` até o máximo configurado. Ele processa um
batch por categoria e devolve JSON com contagens, cutoffs e `batchLimitReached`. Quando uma
categoria atingir o limite, o scheduler deve executar o job novamente. O job deve rodar pelo menos
diariamente.

A operação inteira pertence a uma transação. Em modo `--dry-run`, a sessão é revertida mesmo que
algum driver faça alterações implícitas.

## Tombstones e exclusão definitiva

`DELETE /characters/cloud/{id}` continua sendo soft delete: incrementa a revisão, grava o evento
`deleted` e define `deleted_at`. Durante a retenção, a URL não volta a expor a ficha e nenhuma nova
mutation é aceita.

Depois do cutoff, a remoção física da ficha apaga por cascade:

- events e histórico compactado;
- mutations e snapshots de conflito;
- shares pendentes, ativos ou revogados ligados à ficha.

`audit_events.character_id` usa `ON DELETE SET NULL`, portanto a trilha minimizada permanece até o
cutoff de auditoria sem impedir a exclusão da ficha.

## Cache e dados de viewers

As fichas compartilhadas continuam somente em memória no frontend e não são gravadas no Dexie. O
service worker não registra rota de runtime cache para a API. Além disso:

- o `ApiClient` usa `cache: "no-store"` por padrão;
- `/auth`, `/backups`, `/characters` e `/shared` recebem `Cache-Control: no-store, private`;
- as respostas também recebem `Pragma: no-cache`, `Expires: 0` e `X-Robots-Tag`;
- o contrato SSE mais forte é preservado;
- revogação/deleção limpa o snapshot do estado React já no fluxo existente.

Isso reduz retenção controlada pelo aplicativo. Revogação não consegue apagar screenshots,
exports ou cópias externas já feitas pelo viewer, e essa limitação deve aparecer na política do
produto.

## Backups e conta do usuário

Backups cloud são snapshots explícitos de segurança e permanecem separados de fichas vivas. O
backend mantém o limite por quantidade e oferece exclusão manual; o job de privacidade não decide
sozinho quando um backup ativo deixa de ser desejado.

A remoção física de uma conta no banco usa as FKs existentes para apagar sessões, backups, fichas,
mutations e shares de propriedade. Auditorias usam `SET NULL`. Esta etapa não publica um endpoint
de autoexclusão: antes disso, o produto ainda precisa definir confirmação forte, período de
arrependimento e tratamento de cobrança/suporte.

## Observabilidade sem conteúdo pessoal

O job emite:

```text
privacy.data_lifecycle.completed
daggerheart_data_lifecycle_rows_total
daggerheart_data_lifecycle_duration_seconds
```

As métricas usam apenas categoria e ação. Logs não incluem IDs, e-mails, conteúdo de ficha, token,
IP ou User-Agent.

## Índices

A migration `202607090009` adiciona índices parciais para tombstones, pending shares, revoked
shares e sessões revogadas. `audit_events.created_at` e `refresh_sessions.expires_at` já possuíam
índices adequados.
