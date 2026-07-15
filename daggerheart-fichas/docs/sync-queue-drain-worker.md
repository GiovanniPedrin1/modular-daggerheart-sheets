# Worker de drenagem da syncQueue

A fila de mutações do proprietário é drenada somente quando há uma sessão autenticada, API configurada e conexão online.

## Ordem e bloqueio

- Há no máximo uma requisição de mutation em andamento por instância do worker.
- A ordem é preservada por ficha usando `createdAt`, `localVersion` e `id`.
- Apenas a primeira mutation ainda não resolvida de cada ficha pode ser enviada.
- Um registro `conflict`, `syncing` ou `failed` sem retry bloqueia mutations posteriores da mesma ficha, mas não impede a sincronização de outras fichas.
- Após sucesso, as mutations posteriores da mesma ficha recebem a `appliedRevision` como nova `baseRevision`. Isso evita conflito da ficha com suas próprias alterações já aplicadas.

## Retentativas

Falhas de rede, timeout, sessão HTTP 401, HTTP 408/425/429 e erros 5xx usam backoff exponencial de 2 segundos até o limite de 5 minutos. O horário é persistido em `nextAttemptAt`, portanto recarregar a aplicação não elimina o atraso.

Erros permanentes ficam como `failed` sem `nextAttemptAt`. `SYNC_CONFLICT` fica como `conflict`. Ambos bloqueiam somente a ficha afetada.

## Ciclo de vida

`useCharacterSync` inicia a drenagem após restauração da sessão, login, reconexão ou criação de uma nova mutation pelo autosave. Ao desmontar, sair da conta ou ficar offline, a requisição é cancelada e o item em trânsito volta para `queued`.

A resposta aplicada agora é encaminhada para `completeAppliedSyncMutation`, que atualiza a fila e o `CharacterRecord` na mesma transação. O snapshot cloud só substitui os campos editáveis se `CharacterRecord.version` ainda for igual ao `localVersion` da mutation enviada. Caso exista uma edição local mais nova, apenas os metadados de revisão avançam e os dados locais são preservados.

Detalhes: `docs/sync-response-application.md`.
