# Fase 5 — ciclo de vida da resolução de conflitos

Esta etapa prepara a `syncQueue` para registrar que uma mutation antiga deixou de representar a intenção atual do usuário após uma resolução explícita.

## Novo estado terminal

A fila passa a aceitar:

```ts
status:
  | "queued"
  | "syncing"
  | "failed"
  | "conflict"
  | "applied"
  | "superseded";
```

`applied` e `superseded` são estados terminais:

- `applied`: a mutation foi aceita pelo servidor;
- `superseded`: a mutation não deve mais ser enviada porque foi substituída por uma decisão de resolução.

O worker, o cálculo do próximo retry e o recebimento SSE do dono ignoram ambos os estados terminais. Assim, uma mutation resolvida não continua bloqueando a ficha nem faz uma atualização remota parecer insegura.

## Metadados finais de resolução

Um registro `superseded` pode guardar:

```ts
{
  resolutionStrategy?: "field" | "local" | "remote" | "duplicate";
  resolutionDecisions?: Record<string, "local" | "remote">;
  resolvedAt?: string;
  supersededByMutationId?: string;
}
```

- `resolutionStrategy` registra a ação escolhida;
- `resolutionDecisions` registra a decisão final por JSON Pointer quando a estratégia for campo a campo;
- `resolvedAt` registra quando a decisão foi confirmada;
- `supersededByMutationId` aponta para a nova mutation de resolução, quando houver uma.

O `conflictDetail`, as operações originais e os paths da mutation antiga são preservados no registro superseded. Isso mantém o contexto necessário para auditoria local e diagnóstico.

## Transições protegidas

A função `buildSupersededSyncQueueRecord()` centraliza a transição e:

- valida estratégia, timestamp, decisions e `supersededByMutationId`;
- normaliza os paths das decisões;
- limpa retry e erro transitório;
- rejeita a substituição de uma mutation já `applied`;
- rejeita a substituição de uma mutation ainda `syncing`;
- impede que uma mutation aponte para si própria como sucessora.

`markSyncMutationsSuperseded()` permite aplicar a mesma decisão a uma cadeia de mutations dentro de uma única transação Dexie. A etapa que construir a resolução usará essa operação para encerrar a mutation conflitante e as mutations posteriores incorporadas ao novo resultado.

## IndexedDB versão 4

A versão 4 adiciona índices para:

- `resolvedAt`;
- `supersededByMutationId`.

Na migração, metadados finais de resolução são removidos de registros que não estejam em `superseded`, evitando estados parcialmente gravados por versões experimentais.

## Limites desta etapa

Esta etapa não cria ainda:

- leitura e agrupamento do conflito;
- rascunho de escolhas;
- comparação de valores local/remoto;
- mutation de resolução;
- desbloqueio visual da ficha.

Ela apenas define e protege o ciclo de vida que essas próximas etapas utilizarão.
