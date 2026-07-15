# Acesso do dono às fichas cloud em outro dispositivo

Esta etapa materializa no IndexedDB as fichas cloud ativas da conta autenticada que ainda não possuem vínculo local no dispositivo atual.

## Fluxo

1. Após restaurar a sessão ou concluir login/cadastro, o frontend chama `GET /characters/cloud`.
2. Para cada `remoteId` que já existe localmente, apenas o vínculo de proprietário é validado/reparado. O snapshot local não é sobrescrito.
3. Para cada ficha ainda ausente, o frontend chama `GET /characters/cloud/{id}` e cria um `CharacterRecord` local com:
   - `permission = owner`;
   - `remoteId` e `ownerUserId`;
   - `serverRevision` e `baseRevision` iguais à revisão baixada;
   - `lastSyncedHash` igual ao hash do servidor;
   - `syncStatus = synced`.
4. O `localCharacterId` original é reutilizado quando não existe colisão no dispositivo. Em caso de colisão, um novo ID local é criado sem alterar o ID cloud.

## Limite intencional desta etapa

Uma ficha que já possui `remoteId` local **não é atualizada pelo snapshot da listagem/login**. Ela pode conter alterações locais pendentes, conflito ou uma revisão ainda não enviada. A atualização segura de registros já vinculados pertence às próximas etapas de fila, drenagem e recebimento de alterações de outro dispositivo.

Esse limite evita transformar o login em um mecanismo de `last-write-wins` e mantém a regra de nunca sobrescrever silenciosamente uma edição local.
