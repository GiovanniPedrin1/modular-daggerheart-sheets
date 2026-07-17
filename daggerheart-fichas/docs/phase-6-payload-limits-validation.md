# Fase 6 — limites e validação de payload

Esta etapa aplica os limites centralizados da Fase 6 antes que dados não confiáveis sejam
persistidos ou usados pelo algoritmo de sincronização.

## Camadas de proteção

### 1. Corpo HTTP global

`RequestBodyLimitMiddleware` limita todos os corpos HTTP por
`MAX_REQUEST_BODY_BYTES`.

- Requisições com `Content-Length` acima do limite são recusadas antes da leitura do corpo.
- Requisições sem `Content-Length` são contadas conforme os chunks ASGI chegam.
- O limite é inclusivo: um corpo exatamente no máximo é aceito.
- Erros usam o contrato estável `REQUEST_BODY_TOO_LARGE` e mantêm `X-Request-ID`.
- `Content-Length` negativo ou não numérico retorna `INVALID_CONTENT_LENGTH`.

A ordem dos middlewares mantém o request ID e os headers CORS também nas respostas de limite.

### 2. Limites por funcionalidade

Depois do parsing, os endpoints verificam o tamanho real recebido e os serviços verificam o
JSON canônico normalizado:

| Fluxo | Limite |
|---|---|
| Backup manual | `MAX_CLOUD_BACKUP_PAYLOAD_BYTES` |
| Snapshot de ficha cloud | `MAX_CLOUD_CHARACTER_PAYLOAD_BYTES` |
| Mutation incremental | `MAX_CHARACTER_MUTATION_PAYLOAD_BYTES` |

A dupla verificação evita que whitespace ou envelopes de transporte contornem o limite e
mantém hashes e idempotência baseados na representação canônica.

### 3. Estrutura JSON

`validate_json_payload()` percorre o JSON sem registrar conteúdo do usuário e valida:

- profundidade máxima de arrays e objetos;
- tamanho máximo, em bytes UTF-8, de strings e chaves;
- somente tipos JSON;
- números finitos;
- ausência de ciclos em chamadas internas de serviço.

Os detalhes públicos incluem apenas `reason`, `path`, `limit` e `actual`. O valor rejeitado
nunca é devolvido nem escrito no erro.

Os limites mínimos de startup são quatro níveis de JSON e 64 bytes por string, suficientes
para os envelopes fixos de backup e mutation.

## Regras específicas de mutation

Além do tamanho total, cada mutation respeita os limites configurados para:

- quantidade de `operations`;
- quantidade de `changedPaths`;
- comprimento de cada JSON Pointer;
- quantidade de segmentos de cada JSON Pointer;
- tamanho de `deviceId`;
- profundidade e strings dos valores de operações `set`.

O schema continua exigindo que `changedPaths` seja exatamente igual aos paths das operações,
na mesma ordem canônica, sem duplicação ou sobreposição pai/filho.

Uma violação lógica é persistida como mutation `rejected` com `INVALID_MUTATION`. Excesso de
bytes usa `MUTATION_TOO_LARGE`. Em ambos os casos a ficha e sua revisão permanecem intactas.

## Outros identificadores e parâmetros

- `deviceId` usa `MAX_DEVICE_ID_LENGTH` em autenticação, backup, publicação, snapshot PATCH e
  mutation.
- Alvos de compartilhamento usam `MAX_SHARE_TARGET_LENGTH` sem revelar se uma conta existe.
- `sinceRevision` e `baseRevision` não podem ultrapassar o intervalo do `INTEGER` usado no
  PostgreSQL, evitando overflow durante queries ou persistência de rejeições.
- User-Agent salvo em sessão é truncado pelo limite centralizado de auditoria.

## Códigos de erro

| Código | HTTP | Uso |
|---|---:|---|
| `REQUEST_BODY_TOO_LARGE` | 413 | Corpo HTTP global acima do limite |
| `BACKUP_TOO_LARGE` | 413 | Backup acima do limite da funcionalidade |
| `CHARACTER_TOO_LARGE` | 413 | Snapshot/envelope de ficha acima do limite |
| `MUTATION_TOO_LARGE` | 413 | Mutation ou snapshot resultante acima do limite |
| `INVALID_BACKUP_PAYLOAD` | 422 | Estrutura JSON ou identificador inválido |
| `INVALID_CHARACTER_PAYLOAD` | 422 | Estrutura JSON da ficha inválida |
| `INVALID_CHARACTER_IDENTIFIER` | 422 | Identificador de transporte acima do limite |
| `INVALID_MUTATION` | 422 | Limite lógico, path ou estrutura da mutation inválida |
| `INVALID_DEVICE_ID` | 422 | `deviceId` de autenticação acima do limite |
| `INVALID_SHARE_TARGET` | 422 | Alvo de share inválido ou acima do limite |

## Compatibilidade

Não houve migração de banco. Os limites absolutos dos schemas continuam aceitando payloads
já válidos; configurações de deploy podem apenas reduzir os limites dentro das faixas
revisadas. Retries idempotentes de mutations já persistidas continuam retornando o resultado
anterior mesmo quando uma política foi reduzida depois da aplicação original.
