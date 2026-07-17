# Auditoria dos textos do frontend — estado atual do produto

Data: 17 de julho de 2026

Esta auditoria alinha os textos públicos do frontend às funcionalidades entregues nas fases 1 a 6.

## Modelo do produto refletido nos textos

- O aplicativo continua local-first e utilizável offline.
- Um usuário autenticado pode ativar a sincronização cloud de fichas específicas.
- As fichas próprias sincronizadas ficam disponíveis na mesma conta em outros dispositivos.
- Edições feitas offline são enfileiradas e enviadas depois da reconexão.
- Conflitos são persistidos, bloqueiam a edição e podem ser resolvidos campo a campo, escolhendo uma versão completa ou duplicando a versão local.
- O dono pode compartilhar uma ficha sincronizada em modo leitura.
- Viewers recebem atualizações enquanto estão conectados, mas fichas compartilhadas não são persistidas para uso offline.
- Backups cloud continuam sendo snapshots manuais, separados da sincronização viva das fichas.

## Textos corrigidos

As descrições de conta e configurações deixaram de apresentar a nuvem como um recurso exclusivo de backup. Agora diferenciam sincronização automática, compartilhamento em modo leitura e backups manuais.

Os badges de sincronização passaram a descrever a fila e a revisão conhecidas, sem depender da expressão genérica “último snapshot”.

Os textos de compartilhamento agora informam que viewers ativos podem receber atualizações automaticamente.

Foi removida a mensagem obsoleta que dizia que a duplicação local seria disponibilizada em uma etapa futura, pois essa estratégia já está implementada.

As ações destrutivas agora deixam claro o próprio alcance:

- **Remover deste dispositivo** não apaga a versão cloud, compartilhamentos ou cópias em outros dispositivos.
- **Limpar dados deste dispositivo** remove fichas locais, alterações pendentes, rascunhos de conflito e configurações, mas não apaga fichas cloud nem backups da conta.
- Limpar os dados do dispositivo descarta alterações locais ainda não sincronizadas; remover uma ficha individual não exclui a versão cloud.

Os textos de importação e restauração agora informam que dados da conta, compartilhamentos, vínculos de sync e a fila pendente não fazem parte do formato de backup. Fichas importadas retornam como registros locais.

As descrições HTML e do manifesto PWA agora mencionam edição offline, sincronização entre dispositivos, compartilhamento em modo leitura e backups manuais.

## Ajuste de consistência associado

`clearLocalData()` e as importações nos modos substituir/mesclar agora limpam rascunhos de resolução de conflito junto com os registros locais relacionados. Isso mantém os textos das ações destrutivas verdadeiros e impede que rascunhos obsoletos sobrevivam à limpeza do dispositivo ou à importação de uma ficha.

## Cobertura de regressão

`tests/frontend/appTextsCurrentState.test.ts` verifica que:

- português e inglês expõem o mesmo contrato de tradução;
- os textos de conta apresentam sync, compartilhamento e backups manuais como recursos distintos;
- funcionalidades de conflito já concluídas não são descritas como trabalho futuro;
- ações destrutivas deixam claro o alcance local;
- a importação de backup não promete restaurar vínculos cloud vivos.

`tests/frontend/localDataService.test.ts` verifica que a limpeza de dados locais também inclui os rascunhos de conflito.
