# Fase 5 — classificação e apresentação dos paths em conflito

Esta etapa transforma os JSON Pointers técnicos guardados em `conflictDetail` em um modelo pronto para a futura interface de resolução.

## API

```ts
const presentation = presentCharacterConflictPaths(context);
```

O resultado contém:

```ts
{
  language,
  paths,
  groups,
  simpleCount,
  complexCount,
  hasComplexPaths,
}
```

Cada path apresentado possui:

```ts
{
  path,
  segments,
  sectionKey,
  sectionLabel,
  label,
  classification: "simple" | "complex",
  complexityReasons,
  intersectingRemotePaths,
  local,
  remote,
}
```

## Nomes legíveis

`describeCharacterMutationPath()` conhece os metadados da ficha e os campos atuais da ficha Daggerheart, incluindo:

- identidade, traços, resumo, dano e saúde;
- trackers de PV, Estresse, Esperança, armadura e ouro;
- experiências, armas, armadura ativa e inventário;
- detalhes físicos, habilidades e história;
- progressão e campos extras de Druida e Ranger.

Campos desconhecidos continuam apresentáveis por um fallback que decodifica RFC 6901, separa `snake_case`/`camelCase` e monta um breadcrumb. O path canônico original permanece disponível para persistir as decisões futuras.

## Valores local e remoto

A comparação usa duas fontes diferentes de propósito:

- o valor local vem do `CharacterRecord` bloqueado, que representa todas as edições locais já realizadas;
- o valor remoto vem de `conflictDetail.serverCharacter`, o snapshot exato retornado pelo servidor quando o conflito foi detectado.

Os valores são formatados sem perder o valor bruto:

- booleanos: `Sim/Não` ou `Yes/No`;
- strings vazias e campos ausentes recebem rótulos explícitos;
- sistema, idioma e classe recebem nomes legíveis;
- objetos e arrays são apresentados como JSON identado;
- valores brutos estruturados são clonados antes de serem entregues à UI.

## Classificação

Um path é `simple` quando as duas versões podem ser escolhidas como valores atômicos e o servidor alterou exatamente o mesmo path.

Um path é `complex` quando ocorre ao menos uma destas condições:

- `structured-value`: a versão local ou remota é objeto/array;
- `hierarchical-overlap`: o conflito surgiu entre path pai e descendente, por exemplo `/data/detailsPage` e `/data/detailsPage/story`.

Essa classificação não resolve automaticamente o conflito. Ela informa à futura UI se pode oferecer escolha campo a campo ou se deve tratar o path como um bloco completo e também oferecer duplicação da ficha.

## Agrupamento

Os itens são agrupados e ordenados de acordo com a estrutura visual da ficha: metadados, identidade, traços, saúde, inventário, detalhes, progressão e extras de classe. A ordem dos paths dentro de cada grupo preserva a ordem canônica recebida do backend.

## Limites desta etapa

Ainda não são implementados:

- rascunho persistente das escolhas;
- aplicação de escolhas local/nuvem;
- modal visual de resolução;
- criação da mutation que representa a resolução.
