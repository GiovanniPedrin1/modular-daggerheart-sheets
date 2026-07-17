import type { Language } from "../sheets/daggerheart/types";

export const appTexts = {
  "pt-BR": {
    createCharacter: "Criar personagem",
    selectCharacter: "Selecionar personagem",
    language: "Idioma",
    login: "Conta",
    localProfile: "perfil local",
    logout: "Sair",
    settings: "Configurações",
    onlineStatus: "Online",
    offlineStatus: "Offline",
    offlineBannerTitle: "Você está offline",
    offlineBannerDescription:
      "O app continua funcionando. As alterações ficam salvas neste dispositivo e, nas fichas com sync ativo, entram na fila para envio ao reconectar.",
    profileName: "Nome do perfil",
    saveLogin: "Salvar perfil local",
    cancel: "Cancelar",
    confirm: "Confirmar",
    close: "Fechar",
    createTitle: "Criar personagem",
    characterName: "Nome do personagem",
    system: "Sistema",
    class: "Classe",
    emptyTitle: "Nenhum personagem selecionado",
    emptyDescription: "Crie ou selecione um personagem para começar.",
    loading: "Carregando dados locais...",
    editing: "Editando...",
    saving: "Salvando...",
    savedLocally: "Salvo localmente",
    saveError: "Erro ao salvar localmente",
    cloudSyncActivate: "Ativar sync",
    cloudSyncActivating: "Ativando sync...",
    cloudSyncStatusLabel: "Status da sincronização",
    cloudSyncStatusLocal: "Somente local",
    cloudSyncStatusLocalHelp:
      "Esta ficha está salva apenas neste dispositivo.",
    cloudSyncStatusSyncing: "Enviando...",
    cloudSyncStatusSyncingHelp:
      "A ficha está sendo publicada e vinculada à nuvem.",
    cloudSyncStatusSynced: "Sincronizada",
    cloudSyncStatusSyncedHelp:
      "Este dispositivo está alinhado com a revisão exibida da ficha na nuvem.",
    cloudSyncStatusQueued: "Alterações pendentes",
    cloudSyncStatusQueuedHelp:
      "As alterações locais estão salvas e aguardam envio para a nuvem.",
    cloudSyncStatusConflict: "Conflito",
    cloudSyncStatusConflictHelp:
      "Há alterações concorrentes nos mesmos campos. Resolva o conflito para retomar a sincronização.",
    cloudSyncConflictLockTitle: "Edição bloqueada por conflito",
    cloudSyncConflictLockDescription:
      "As alterações locais foram preservadas. Resolva o conflito antes de continuar editando esta ficha.",
    cloudSyncConflictResolveButton: "Resolver conflito",
    characterConflictTitle: "Resolver conflito de sincronização",
    characterConflictDescription: (name: string) =>
      name
        ? `Compare as versões de “${name}” e escolha qual valor deve ser mantido em cada campo.`
        : "Compare as versões local e da nuvem e escolha qual valor deve ser mantido.",
    characterConflictLoading: "Carregando detalhes do conflito...",
    characterConflictLoadError:
      "Não foi possível carregar os detalhes deste conflito. Feche o modal e tente novamente.",
    characterConflictServerRevision: "Revisão da nuvem",
    characterConflictFieldsLabel: "Campos em conflito",
    characterConflictComplexFieldsLabel: "Blocos complexos",
    characterConflictNewerRevisionTitle: "A nuvem mudou novamente",
    characterConflictNewerRevisionDescription:
      "A nuvem recebeu novas alterações enquanto este conflito estava aberto. Atualize a comparação antes de continuar; escolhas compatíveis serão preservadas.",
    characterConflictRefreshButton: "Atualizar comparação",
    characterConflictRefreshing: "Atualizando comparação...",
    characterConflictRefreshSuccess: (preserved: number, added: number) =>
      `${preserved} escolha(s) preservada(s) e ${added} novo(s) campo(s) para revisar.`,
    characterConflictRefreshUnchanged:
      "A comparação já usa a revisão mais recente da nuvem.",
    characterConflictRefreshError:
      "Não foi possível atualizar a comparação. Verifique a conexão e tente novamente.",
    characterConflictDraftStale:
      "Existe um rascunho de escolhas para uma versão anterior deste conflito. Ele foi preservado, mas não será aplicado a esta comparação.",
    characterConflictStrategyTitle: "Como deseja escolher?",
    characterConflictStrategyDescription:
      "Você pode revisar campo a campo ou preencher todas as escolhas com uma das versões.",
    characterConflictStrategyField: "Escolher campo a campo",
    characterConflictStrategyLocal: "Usar tudo local",
    characterConflictStrategyRemote: "Usar tudo da nuvem",
    characterConflictStrategyDuplicate: "Duplicar versão local",
    characterConflictDuplicateTitle: "Preservar uma cópia independente",
    characterConflictDuplicateDescription:
      "A versão deste dispositivo será criada como uma nova ficha local, sem vínculo com a nuvem. A ficha original voltará a mostrar a revisão atual da nuvem.",
    characterConflictProgress: (chosen: number, total: number) =>
      `${chosen} de ${total} campo(s) escolhidos`,
    characterConflictDuplicateProgress:
      "Nenhuma escolha por campo é necessária para criar a cópia local.",
    characterConflictDraftAutosave:
      "As escolhas são salvas automaticamente neste dispositivo.",
    characterConflictDraftSaving: "Salvando escolhas...",
    characterConflictDraftSaved: "Escolhas salvas neste dispositivo.",
    characterConflictDraftSaveError:
      "Não foi possível salvar as escolhas. Tente selecionar o campo novamente.",
    characterConflictLocalVersion: "Versão deste dispositivo",
    characterConflictCloudVersion: "Versão da nuvem",
    characterConflictComplexLabel: "Bloco complexo",
    characterConflictComplexStructuredHelp:
      "Este valor contém uma estrutura completa. A escolha substitui o bloco inteiro.",
    characterConflictComplexHierarchyHelp:
      "A nuvem alterou um campo pai ou filho relacionado. A escolha é aplicada ao bloco para evitar uma combinação insegura.",
    characterConflictChooseAll:
      "Escolha uma versão para todos os campos antes de confirmar.",
    characterConflictApplyReady:
      "Ao confirmar, as mutações antigas serão encerradas e uma nova mutação de resolução será enviada com base na revisão atual da nuvem.",
    characterConflictNoMutation:
      "Estas escolhas mantêm integralmente a versão da nuvem. Ao confirmar, as alterações locais deste conflito serão descartadas com segurança e nenhuma mutação será enviada.",
    characterConflictDuplicateReady:
      "Ao confirmar, a versão local será preservada em uma nova ficha independente e a ficha cloud será restaurada para a revisão atual da nuvem. Nenhuma mutação será enviada.",
    characterConflictConfirm: "Confirmar e sincronizar",
    characterConflictDiscard: "Descartar alterações locais",
    characterConflictDuplicateConfirm: "Duplicar e manter nuvem",
    characterConflictSubmitting: "Preparando sincronização...",
    characterConflictDiscarding: "Descartando alterações locais...",
    characterConflictDuplicating: "Duplicando ficha...",
    characterConflictSubmitError:
      "Não foi possível preparar a resolução. O conflito e suas escolhas continuam preservados; tente novamente.",
    cloudSyncConflictDeleteHelp:
      "Resolva o conflito antes de remover esta ficha deste dispositivo.",
    cloudSyncStatusReadonly: "Somente leitura",
    cloudSyncStatusReadonlyHelp:
      "Esta ficha pode ser visualizada, mas não editada neste dispositivo.",
    cloudSyncStatusRevision: (revision: number) => `rev. ${revision}`,
    cloudSyncActivateHelp:
      "Publica esta ficha na sua conta, habilita a sincronização automática e permite acesso em outros dispositivos e compartilhamento em modo leitura.",
    cloudSyncActiveHelp:
      "Esta ficha está vinculada à nuvem. Alterações locais são enfileiradas e sincronizadas automaticamente quando há conexão.",
    cloudSyncOfflineHelp: "Conecte-se à internet para ativar o sync desta ficha.",
    cloudSyncLoginRequiredHelp:
      "Entre na sua conta para ativar o sync desta ficha.",
    cloudSyncUnavailableHelp:
      "A API de nuvem não está configurada neste ambiente.",
    cloudSyncPreparing: "Salvando alterações locais e publicando a ficha...",
    cloudSyncLocalSaveError:
      "Não foi possível concluir o salvamento local antes de ativar o sync.",
    cloudSyncActivated: "Sync ativado. A ficha foi publicada na nuvem.",
    cloudSyncAlreadyActivated:
      "O vínculo cloud já existia e foi restaurado neste dispositivo.",
    cloudSyncActivatedWithQueuedChanges:
      "Sync ativado. Alterações feitas durante o envio ficaram pendentes para a próxima sincronização.",
    cloudSyncActivateError: "Não foi possível ativar o sync desta ficha.",
    ownerCloudCharactersImported: (count: number) =>
      count === 1
        ? "1 ficha da sua conta foi disponibilizada neste dispositivo."
        : `${count} fichas da sua conta foram disponibilizadas neste dispositivo.`,
    ownerCloudCharactersLoadError:
      "Não foi possível carregar suas fichas cloud neste dispositivo.",
    characterShareButton: "Compartilhar",
    characterShareButtonHelp:
      "Gerencie quem pode visualizar esta ficha em modo leitura e receber suas atualizações.",
    characterShareOfflineHelp:
      "Conecte-se à internet para gerenciar o compartilhamento desta ficha.",
    characterShareLoginRequiredHelp:
      "Entre na conta proprietária para compartilhar esta ficha.",
    characterShareUnavailableHelp:
      "A API de nuvem não está configurada neste ambiente.",
    characterShareWrongAccountHelp:
      "Esta ficha pertence a outra conta. Entre na conta proprietária para gerenciar o compartilhamento.",
    characterShareTitle: "Compartilhar ficha",
    characterShareDescription: (name: string) =>
      `Permita que outra pessoa visualize “${name}” em modo leitura.`,
    characterShareTargetType: "Compartilhar por",
    characterShareByEmail: "E-mail",
    characterShareByPublicCode: "Código público",
    characterShareEmailLabel: "E-mail da pessoa",
    characterShareEmailPlaceholder: "pessoa@exemplo.com",
    characterShareCodeLabel: "Código público da pessoa",
    characterShareCodePlaceholder: "ABCDEF0123456789",
    characterShareOwnCodeLabel: "Seu código público:",
    characterShareSend: "Compartilhar",
    characterShareSending: "Compartilhando...",
    characterShareCurrentTitle: "Acessos atuais",
    characterShareCurrentDescription:
      "Essas pessoas podem abrir a ficha em modo leitura. Enquanto conectadas, recebem as atualizações automaticamente.",
    characterShareLoading: "Carregando acessos...",
    characterShareEmpty: "Esta ficha ainda não foi compartilhada.",
    characterShareEmailTarget: "E-mail",
    characterShareCodeTarget: "Código público",
    characterShareCreatedAt: (date: string) => `criado em ${date}`,
    characterShareRevoke: "Revogar",
    characterShareRevoking: "Revogando...",
    characterShareCreated:
      "Compartilhamento criado. Por privacidade, não informamos se o e-mail já possui conta.",
    characterShareAlreadyExists:
      "Essa pessoa já possui um compartilhamento atual desta ficha.",
    characterShareRevoked: "Acesso revogado.",
    characterShareLoadError: "Não foi possível carregar os compartilhamentos.",
    characterShareCreateError: "Não foi possível compartilhar esta ficha.",
    characterShareRevokeError: "Não foi possível revogar este acesso.",
    characterShareInvalidEmail: "Informe um endereço de e-mail válido.",
    characterShareInvalidCode: "Informe um código público válido.",
    characterShareTargetRequired: "Informe um e-mail ou código público.",
    characterShareCannotShareWithSelf:
      "Você já é o proprietário desta ficha e não precisa compartilhá-la consigo mesmo.",
    characterShareInvalidTarget:
      "Não foi possível usar esse destinatário. Revise o e-mail ou código público.",
    characterShareCharacterUnavailable:
      "A ficha cloud não está disponível para esta conta.",
    characterShareOffline:
      "Você está offline. Os acessos existentes continuam listados, mas não podem ser alterados agora.",
    myCharacters: "Minhas fichas",
    sharedCharactersNavigation: "Compartilhadas comigo",
    sharedCharactersTitle: "Compartilhadas comigo",
    sharedCharactersDescription:
      "Fichas que outras pessoas compartilharam com você em modo leitura.",
    sharedCharactersLoading: "Carregando fichas...",
    sharedCharactersRefresh: "Atualizar",
    sharedCharactersTryAgain: "Tentar novamente",
    sharedCharactersEmpty: "Nenhuma ficha foi compartilhada com esta conta.",
    sharedCharactersLoadError: "Não foi possível carregar as fichas compartilhadas.",
    sharedCharactersUnavailable:
      "A API de nuvem não está configurada neste ambiente.",
    sharedCharactersLoginRequired:
      "Entre na sua conta para ver as fichas compartilhadas com você.",
    sharedCharactersLoginAction: "Entrar na conta",
    sharedCharactersOffline:
      "As fichas compartilhadas não ficam salvas offline. Conecte-se à internet para visualizá-las.",
    sharedCharactersBack: "Voltar para compartilhadas",
    sharedCharacterLoading: "Carregando ficha compartilhada...",
    sharedCharacterLoadError: "Não foi possível carregar esta ficha compartilhada.",
    sharedCharacterNotFound:
      "Esta ficha não está mais disponível ou o acesso foi revogado.",
    sharedCharacterUnavailableTitle: "Ficha indisponível",
    sharedCharacterAccessRevokedTitle: "Acesso revogado",
    sharedCharacterAccessRevoked:
      "O proprietário revogou seu acesso. A ficha foi removida desta sessão.",
    sharedCharacterDeletedTitle: "Ficha removida",
    sharedCharacterDeleted:
      "O proprietário removeu esta ficha. Ela não está mais disponível.",
    sharedCharacterReadOnlyLabel: "Modo leitura",
    sharedCharacterRealtimeStatusLabel: "Conexão em tempo real",
    sharedCharacterRealtimeConnecting: "Conectando...",
    sharedCharacterRealtimeConnectingHelp:
      "Estabelecendo a conexão para receber atualizações da ficha.",
    sharedCharacterRealtimeLive: "Ao vivo",
    sharedCharacterRealtimeLiveHelp:
      "As alterações do proprietário aparecem automaticamente.",
    sharedCharacterRealtimeReconnecting: "Reconectando...",
    sharedCharacterRealtimeReconnectingHelp:
      "A conexão foi interrompida e está sendo restabelecida.",
    sharedCharacterRealtimeOffline: "Offline",
    sharedCharacterRealtimeOfflineHelp:
      "Sem conexão com a internet. A ficha será recarregada ao reconectar.",
    sharedCharacterRealtimeClosed: "Tempo real indisponível",
    sharedCharacterRealtimeClosedHelp:
      "As atualizações automáticas estão indisponíveis. Use Atualizar para buscar a versão mais recente.",
    sharedCharacterOwnerLabel: "Compartilhada por",
    sharedCharacterOwnerUnknown: "Proprietário",
    sharedCharacterRevisionLabel: "Revisão",
    sharedCharacterUpdatedLabel: "Atualizada em",
    sharedCharacterRevisionShort: (revision: number) => `rev. ${revision}`,
    sharedCharacterOpen: "Abrir ficha",
    deleteCharacter: "Remover deste dispositivo",
    delete: "Remover",
    deletePrompt: "Para remover esta ficha deste dispositivo, digite exatamente:",
    deleteDescription:
      "Esta ação remove a ficha da lista deste dispositivo. A versão na nuvem, os compartilhamentos e as cópias em outros dispositivos não são apagados. Se ela existir somente aqui, exporte um backup antes para manter uma cópia.",
    settingsTitle: "Configurações locais",
    settingsDescription:
      "Gerencie preferências, dados deste dispositivo, backups manuais e sua conta. A edição continua disponível offline.",
    cloudTitle: "Conta e nuvem",
    cloudDescription:
      "Backups da conta são manuais. Fichas com sync ativo são sincronizadas automaticamente e podem ser acessadas em outros dispositivos.",
    cloudStatusSignedOut: "Login necessário",
    cloudStatusSignedIn: "Conectado",
    cloudStatusCheckingSession: "Verificando sessão",
    cloudStatusApiPending: "Nuvem indisponível",
    cloudStatusOffline: "Offline",
    cloudSaveBackup: "Salvar backup na nuvem",
    cloudRestoreLatest: "Restaurar último backup",
    cloudRefreshBackups: "Atualizar lista",
    cloudLastBackupLabel: "Último backup",
    cloudLastRestoreLabel: "Última restauração",
    cloudNeverBackedUp: "Nenhum backup na nuvem ainda.",
    cloudLastBackup: (date: string) => `Último backup: ${new Date(date).toLocaleString("pt-BR")}`,
    cloudLastRestore: (date: string) => new Date(date).toLocaleString("pt-BR"),
    cloudDeviceIdLabel: "Dispositivo",
    cloudAccountLabel: "Conta",
    cloudOfflineHelp:
      "Conecte-se à internet para usar sincronização, compartilhamento ou backups na nuvem.",
    cloudLoginRequiredHelp:
      "Entre na sua conta para sincronizar e compartilhar fichas ou salvar e restaurar backups. A edição local continua sem login.",
    cloudSignedInHelp:
      "Fichas com sync ativo são sincronizadas automaticamente. Backups continuam manuais e separados da versão viva das fichas.",
    cloudApiPendingHelp:
      "Sincronização, compartilhamento e backups na nuvem não estão disponíveis neste ambiente. Seus dados locais continuam funcionando normalmente.",
    cloudWorking: "Processando...",
    cloudPreparingBackup: "Salvando alterações locais antes do backup...",
    cloudUploadingBackup: "Enviando backup para a nuvem...",
    cloudBackupSavedWithCount: (characters: number) =>
      `Backup salvo na nuvem com ${characters} personagem(ns).`,
    cloudBackupDuplicate: "O backup mais recente já contém esses dados. Nada novo foi enviado.",
    cloudBackupsRefreshed: "Lista de backups atualizada.",
    cloudSaveLocalError:
      "Não foi possível concluir o salvamento local antes do backup. Tente novamente.",
    cloudSaveBackupError: "Não foi possível salvar backup na nuvem.",
    cloudListBackupsError: "Não foi possível carregar a lista de backups.",
    cloudRestoreLoading: "Carregando backup da nuvem...",
    cloudRestoreApplying: "Mesclando backup da nuvem com seus dados locais...",
    cloudRestoreThisBackup: "Restaurar",
    cloudRestoreMergeTitle: "Restaurar backup em modo mesclar",
    cloudRestoreMergeDescription:
      "Revise o backup antes de mesclar. Este modo adiciona/atualiza dados do backup sem apagar os dados locais que não estiverem nele.",
    cloudRestoreRemoteBackup: "Backup na nuvem",
    cloudRestoreLocalData: "Dados locais atuais",
    cloudRestoreMergeKeepsLocal:
      "Personagens locais que não existem no backup continuam neste dispositivo.",
    cloudRestoreMergeNotice:
      "A restauração em modo mesclar não apaga fichas ausentes do backup. Os vínculos de sync e compartilhamento não fazem parte do backup e não são restaurados.",
    cloudRestoreMergeConfirm: "Mesclar backup",
    cloudRestoreReplaceStart: "Substituir dados locais",
    cloudRestoreReplaceTitle: "Substituir dados locais por backup da nuvem",
    cloudRestoreReplaceDescription:
      "Este modo apaga os dados locais deste dispositivo e importa o conteúdo do backup selecionado.",
    cloudRestoreReplaceRemovesLocal:
      "Personagens locais que não existem no backup serão removidos deste dispositivo.",
    cloudRestoreReplaceWarning:
      "Atenção: esta ação substitui as fichas e configurações deste dispositivo. Os vínculos de sync e compartilhamento não fazem parte do backup; as fichas importadas voltam como locais.",
    cloudRestoreExportLocalFirst: "Exportar backup local antes",
    cloudRestoreReplacePrompt: "Para confirmar, digite exatamente:",
    cloudRestoreReplaceToken: "SUBSTITUIR",
    cloudRestoreReplaceConfirm: "Substituir dados locais",
    cloudRestoreReplaceApplying: "Substituindo dados locais pelo backup da nuvem...",
    cloudRestoreSuccess: (characters: number, settings: number) =>
      `Backup restaurado em modo mesclar: ${characters} personagem(ns) e ${settings} configuração(ões).`,
    cloudRestoreReplaceSuccess: (characters: number, settings: number) =>
      `Backup restaurado em modo substituir: ${characters} personagem(ns) e ${settings} configuração(ões).`,
    cloudRestoreError: "Não foi possível restaurar o backup da nuvem.",
    cloudBackupListTitle: "Backups recentes",
    cloudBackupListEmpty: "Nenhum backup encontrado nesta conta.",
    cloudBackupSummary: (characters: number, appVersion: string) =>
      `${characters} personagem(ns) • app ${appVersion}`,
    authAccountTitle: "Conta conectada",
    authLoginTitle: "Entrar na conta",
    authRegisterTitle: "Criar conta",
    authLoginDescription:
      "Entre para sincronizar fichas entre dispositivos, compartilhar em modo leitura e usar backups manuais. A edição local continua sem login.",
    authRegisterDescription:
      "Crie uma conta para sincronizar fichas entre dispositivos, compartilhar em modo leitura e guardar backups manuais. Suas fichas continuam salvas primeiro neste dispositivo.",
    authSignedInDescription:
      "Sua conta está conectada. Fichas com sync ativo sincronizam automaticamente; backups continuam manuais e opcionais.",
    authEmail: "Email",
    authEmailPlaceholder: "voce@email.com",
    authPassword: "Senha",
    authPasswordPlaceholder: "Sua senha",
    authConfirmPassword: "Confirmar senha",
    authConfirmPasswordPlaceholder: "Digite a senha novamente",
    authDisplayName: "Nome exibido",
    authDisplayNamePlaceholder: "Como você quer aparecer",
    authPasswordHelp: "Use pelo menos 8 caracteres. A senha é protegida no servidor e nunca é salva em texto puro.",
    authLocalFirstNotice:
      "Suas fichas continuam salvas localmente e disponíveis offline. Na conta ficam as fichas com sync ativado, seus compartilhamentos e os backups enviados manualmente.",
    authModeTabsLabel: "Escolher modo de autenticação",
    authNotAvailableTitle: "Nuvem não configurada",
    authNotAvailableDescription:
      "Conta, sincronização, compartilhamento e backups na nuvem não estão disponíveis neste ambiente. Você ainda pode salvar um perfil local para identificar este dispositivo.",
    authSignIn: "Entrar",
    authCreateAccount: "Criar conta",
    authMissingFields: "Preencha email e senha.",
    authEmailInvalid: "Digite um email válido.",
    authPasswordTooShort: "A senha precisa ter pelo menos 8 caracteres.",
    authPasswordMismatch: "As senhas não conferem.",
    authSuccess: "Sessão iniciada com sucesso.",
    authLoginError: "Não foi possível entrar na conta.",
    authRegisterError: "Não foi possível criar a conta.",
    authLogoutSuccess:
      "Você saiu da conta. Seus dados locais continuam neste dispositivo; sync e compartilhamento ficam indisponíveis até entrar novamente.",
    authLogoutError: "Não foi possível sair da conta.",
    requestId: "ID da requisição",
    appVersion: "Versão do app",
    visualPreferences: "Preferências visuais",
    visualPreferencesDescription:
      "Ajuste tema e opções visuais salvas localmente neste dispositivo.",
    theme: "Tema",
    themeLight: "Claro",
    themeDark: "Escuro",
    themeSystem: "Sistema",
    classDecorations: "Decorações por classe",
    classDecorationsHelp:
      "Ativa ou desativa identidades visuais opcionais baseadas na classe do personagem.",
    localData: "Dados locais",
    exportData: "Exportar dados",
    exportDescription:
      "Baixa um arquivo JSON com fichas e configurações locais. Conta, compartilhamentos, vínculos de sync e fila pendente não são incluídos.",
    importData: "Importar dados",
    importDescription:
      "Importe um backup JSON exportado por este app. As fichas importadas entram como locais, sem restaurar vínculos de sync ou compartilhamento.",
    importMode: "Modo de importação",
    mergeImport: "Mesclar com dados atuais",
    replaceImport: "Substituir todos os dados locais",
    chooseBackupFile: "Escolher arquivo JSON",
    clearData: "Limpar dados locais",
    clearDataDescription:
      "Remove fichas, alterações pendentes, rascunhos de conflito e configurações deste navegador. Dados já enviados à nuvem e backups da conta não são apagados.",
    clearDataTitle: "Limpar todos os dados deste dispositivo?",
    clearDataPrompt: "Para confirmar, digite exatamente:",
    clearDataToken: "LIMPAR",
    clearDataWarning:
      "Essa ação apaga os dados deste dispositivo, incluindo alterações ainda não sincronizadas. Fichas e backups já salvos na nuvem permanecem na conta.",
    exportSuccess: "Backup exportado com sucesso.",
    exportError: "Não foi possível exportar os dados locais.",
    importSuccess: (characters: number, settings: number) =>
      `Importação concluída: ${characters} personagem(ns) e ${settings} configuração(ões).`,
    importError:
      "Não foi possível importar. Verifique se o arquivo é um backup JSON válido deste app.",
    clearSuccess: "Dados deste dispositivo apagados. A nuvem não foi alterada.",
    clearError: "Não foi possível limpar os dados locais.",
    currentSummary: (characters: number) =>
      `${characters} personagem(ns) ativo(s) neste dispositivo.`,
    classes: {
      daggerheart: {
        sorcerer: "Feiticeiro",
        druid: "Druida",
        ranger: "Patrulheiro",
        warrior: "Guerreiro",
        guardian: "Guardião",
        seraph: "Serafim",
        wizard: "Mago",
        bard: "Bardo",
        rogue: "Ladino",
      },
    },
  },
  "en-US": {
    createCharacter: "Create character",
    selectCharacter: "Select character",
    language: "Language",
    login: "Account",
    localProfile: "local profile",
    logout: "Logout",
    settings: "Settings",
    onlineStatus: "Online",
    offlineStatus: "Offline",
    offlineBannerTitle: "You are offline",
    offlineBannerDescription:
      "The app keeps working. Changes stay saved on this device and, for synced characters, are queued until the connection returns.",
    profileName: "Profile name",
    saveLogin: "Save local profile",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    createTitle: "Create character",
    characterName: "Character name",
    system: "System",
    class: "Class",
    emptyTitle: "No character selected",
    emptyDescription: "Create or select a character to start.",
    loading: "Loading local data...",
    editing: "Editing...",
    saving: "Saving...",
    savedLocally: "Saved locally",
    saveError: "Local save error",
    cloudSyncActivate: "Enable sync",
    cloudSyncActivating: "Enabling sync...",
    cloudSyncStatusLabel: "Sync status",
    cloudSyncStatusLocal: "Local only",
    cloudSyncStatusLocalHelp:
      "This character is saved only on this device.",
    cloudSyncStatusSyncing: "Uploading...",
    cloudSyncStatusSyncingHelp:
      "The character is being published and linked to the cloud.",
    cloudSyncStatusSynced: "Synced",
    cloudSyncStatusSyncedHelp:
      "This device is aligned with the displayed cloud revision of the character.",
    cloudSyncStatusQueued: "Changes pending",
    cloudSyncStatusQueuedHelp:
      "Local changes are saved and waiting to be uploaded to the cloud.",
    cloudSyncStatusConflict: "Conflict",
    cloudSyncStatusConflictHelp:
      "The same fields changed concurrently. Resolve the conflict to resume synchronization.",
    cloudSyncConflictLockTitle: "Editing blocked by conflict",
    cloudSyncConflictLockDescription:
      "Your local changes were preserved. Resolve the conflict before editing this character again.",
    cloudSyncConflictResolveButton: "Resolve conflict",
    characterConflictTitle: "Resolve sync conflict",
    characterConflictDescription: (name: string) =>
      name
        ? `Compare the versions of “${name}” and choose which value to keep for each field.`
        : "Compare the local and cloud versions and choose which value to keep.",
    characterConflictLoading: "Loading conflict details...",
    characterConflictLoadError:
      "Could not load this conflict. Close the dialog and try again.",
    characterConflictServerRevision: "Cloud revision",
    characterConflictFieldsLabel: "Conflicting fields",
    characterConflictComplexFieldsLabel: "Complex blocks",
    characterConflictNewerRevisionTitle: "The cloud changed again",
    characterConflictNewerRevisionDescription:
      "The cloud changed while this conflict was open. Refresh the comparison before continuing; compatible choices will be preserved.",
    characterConflictRefreshButton: "Refresh comparison",
    characterConflictRefreshing: "Refreshing comparison...",
    characterConflictRefreshSuccess: (preserved: number, added: number) =>
      `${preserved} choice(s) preserved and ${added} new field(s) to review.`,
    characterConflictRefreshUnchanged:
      "The comparison already uses the latest cloud revision.",
    characterConflictRefreshError:
      "The comparison could not be refreshed. Check your connection and try again.",
    characterConflictDraftStale:
      "There is a saved choice draft for an earlier version of this conflict. It was preserved, but it will not be applied to this comparison.",
    characterConflictStrategyTitle: "How do you want to choose?",
    characterConflictStrategyDescription:
      "Review each field or fill every choice with one version.",
    characterConflictStrategyField: "Choose field by field",
    characterConflictStrategyLocal: "Use all local",
    characterConflictStrategyRemote: "Use all cloud",
    characterConflictStrategyDuplicate: "Duplicate local version",
    characterConflictDuplicateTitle: "Preserve an independent copy",
    characterConflictDuplicateDescription:
      "This device's version will become a new local-only character with no cloud link. The original character will return to the current cloud revision.",
    characterConflictProgress: (chosen: number, total: number) =>
      `${chosen} of ${total} field(s) chosen`,
    characterConflictDuplicateProgress:
      "No field-by-field choices are needed to create the local copy.",
    characterConflictDraftAutosave:
      "Choices are saved automatically on this device.",
    characterConflictDraftSaving: "Saving choices...",
    characterConflictDraftSaved: "Choices saved on this device.",
    characterConflictDraftSaveError:
      "Could not save the choices. Select the field again to retry.",
    characterConflictLocalVersion: "This device's version",
    characterConflictCloudVersion: "Cloud version",
    characterConflictComplexLabel: "Complex block",
    characterConflictComplexStructuredHelp:
      "This value contains a complete structure. The choice replaces the entire block.",
    characterConflictComplexHierarchyHelp:
      "The cloud changed a related parent or child field. The choice applies to the block to avoid an unsafe combination.",
    characterConflictChooseAll:
      "Choose a version for every field before confirming.",
    characterConflictApplyReady:
      "When you confirm, the old mutations will be closed and a new resolution mutation will be queued from the current cloud revision.",
    characterConflictNoMutation:
      "These choices keep the cloud version in full. When you confirm, the local changes in this conflict will be safely discarded and no mutation will be sent.",
    characterConflictDuplicateReady:
      "When you confirm, the local version will be preserved as a new independent character and the cloud character will be restored to the current cloud revision. No mutation will be sent.",
    characterConflictConfirm: "Confirm and sync",
    characterConflictDiscard: "Discard local changes",
    characterConflictDuplicateConfirm: "Duplicate and keep cloud",
    characterConflictSubmitting: "Preparing sync...",
    characterConflictDiscarding: "Discarding local changes...",
    characterConflictDuplicating: "Duplicating character...",
    characterConflictSubmitError:
      "Could not prepare the resolution. The conflict and your choices remain preserved; try again.",
    cloudSyncConflictDeleteHelp:
      "Resolve the conflict before removing this character from this device.",
    cloudSyncStatusReadonly: "Read only",
    cloudSyncStatusReadonlyHelp:
      "This character can be viewed but not edited on this device.",
    cloudSyncStatusRevision: (revision: number) => `rev. ${revision}`,
    cloudSyncActivateHelp:
      "Publishes this character to your account, enables automatic synchronization, and allows access from other devices and read-only sharing.",
    cloudSyncActiveHelp:
      "This character is linked to the cloud. Local changes are queued and synchronized automatically when connected.",
    cloudSyncOfflineHelp: "Connect to the internet to enable sync for this character.",
    cloudSyncLoginRequiredHelp:
      "Sign in to your account to enable sync for this character.",
    cloudSyncUnavailableHelp:
      "The cloud API is not configured in this environment.",
    cloudSyncPreparing: "Saving local changes and publishing the character...",
    cloudSyncLocalSaveError:
      "Could not finish the local save before enabling sync.",
    cloudSyncActivated: "Sync enabled. The character was published to the cloud.",
    cloudSyncAlreadyActivated:
      "The cloud link already existed and was restored on this device.",
    cloudSyncActivatedWithQueuedChanges:
      "Sync enabled. Changes made during upload are queued for the next synchronization.",
    cloudSyncActivateError: "Could not enable sync for this character.",
    ownerCloudCharactersImported: (count: number) =>
      count === 1
        ? "1 character from your account is now available on this device."
        : `${count} characters from your account are now available on this device.`,
    ownerCloudCharactersLoadError:
      "Could not load your cloud characters on this device.",
    characterShareButton: "Share",
    characterShareButtonHelp:
      "Manage who can view this character in read-only mode and receive its updates.",
    characterShareOfflineHelp:
      "Connect to the internet to manage sharing for this character.",
    characterShareLoginRequiredHelp:
      "Sign in to the owner account to share this character.",
    characterShareUnavailableHelp:
      "The cloud API is not configured in this environment.",
    characterShareWrongAccountHelp:
      "This character belongs to another account. Sign in to the owner account to manage sharing.",
    characterShareTitle: "Share character",
    characterShareDescription: (name: string) =>
      `Allow another person to view “${name}” in read-only mode.`,
    characterShareTargetType: "Share by",
    characterShareByEmail: "E-mail",
    characterShareByPublicCode: "Public code",
    characterShareEmailLabel: "Person's e-mail",
    characterShareEmailPlaceholder: "person@example.com",
    characterShareCodeLabel: "Person's public code",
    characterShareCodePlaceholder: "ABCDEF0123456789",
    characterShareOwnCodeLabel: "Your public code:",
    characterShareSend: "Share",
    characterShareSending: "Sharing...",
    characterShareCurrentTitle: "Current access",
    characterShareCurrentDescription:
      "These people can open the character in read-only mode. While connected, they receive updates automatically.",
    characterShareLoading: "Loading access...",
    characterShareEmpty: "This character has not been shared yet.",
    characterShareEmailTarget: "E-mail",
    characterShareCodeTarget: "Public code",
    characterShareCreatedAt: (date: string) => `created on ${date}`,
    characterShareRevoke: "Revoke",
    characterShareRevoking: "Revoking...",
    characterShareCreated:
      "Sharing created. For privacy, we do not reveal whether the e-mail already has an account.",
    characterShareAlreadyExists:
      "This person already has a current share for this character.",
    characterShareRevoked: "Access revoked.",
    characterShareLoadError: "Could not load character shares.",
    characterShareCreateError: "Could not share this character.",
    characterShareRevokeError: "Could not revoke this access.",
    characterShareInvalidEmail: "Enter a valid e-mail address.",
    characterShareInvalidCode: "Enter a valid public code.",
    characterShareTargetRequired: "Enter an e-mail address or public code.",
    characterShareCannotShareWithSelf:
      "You already own this character and do not need to share it with yourself.",
    characterShareInvalidTarget:
      "That recipient could not be used. Check the e-mail address or public code.",
    characterShareCharacterUnavailable:
      "The cloud character is not available to this account.",
    characterShareOffline:
      "You are offline. Existing access remains listed, but it cannot be changed now.",
    myCharacters: "My characters",
    sharedCharactersNavigation: "Shared with me",
    sharedCharactersTitle: "Shared with me",
    sharedCharactersDescription:
      "Characters other people shared with you in read-only mode.",
    sharedCharactersLoading: "Loading characters...",
    sharedCharactersRefresh: "Refresh",
    sharedCharactersTryAgain: "Try again",
    sharedCharactersEmpty: "No character has been shared with this account.",
    sharedCharactersLoadError: "Could not load shared characters.",
    sharedCharactersUnavailable:
      "The cloud API is not configured in this environment.",
    sharedCharactersLoginRequired:
      "Sign in to see characters shared with you.",
    sharedCharactersLoginAction: "Sign in",
    sharedCharactersOffline:
      "Shared characters are not stored offline. Connect to the internet to view them.",
    sharedCharactersBack: "Back to shared characters",
    sharedCharacterLoading: "Loading shared character...",
    sharedCharacterLoadError: "Could not load this shared character.",
    sharedCharacterNotFound:
      "This character is no longer available or access was revoked.",
    sharedCharacterUnavailableTitle: "Character unavailable",
    sharedCharacterAccessRevokedTitle: "Access revoked",
    sharedCharacterAccessRevoked:
      "The owner revoked your access. The character was removed from this session.",
    sharedCharacterDeletedTitle: "Character removed",
    sharedCharacterDeleted:
      "The owner removed this character. It is no longer available.",
    sharedCharacterReadOnlyLabel: "Read-only mode",
    sharedCharacterRealtimeStatusLabel: "Realtime connection",
    sharedCharacterRealtimeConnecting: "Connecting...",
    sharedCharacterRealtimeConnectingHelp:
      "Establishing the connection for character updates.",
    sharedCharacterRealtimeLive: "Live",
    sharedCharacterRealtimeLiveHelp:
      "The owner's changes appear automatically.",
    sharedCharacterRealtimeReconnecting: "Reconnecting...",
    sharedCharacterRealtimeReconnectingHelp:
      "The connection was interrupted and is being restored.",
    sharedCharacterRealtimeOffline: "Offline",
    sharedCharacterRealtimeOfflineHelp:
      "There is no internet connection. The character will reload after reconnecting.",
    sharedCharacterRealtimeClosed: "Realtime unavailable",
    sharedCharacterRealtimeClosedHelp:
      "Automatic updates are unavailable. Use Refresh to fetch the latest version.",
    sharedCharacterOwnerLabel: "Shared by",
    sharedCharacterOwnerUnknown: "Owner",
    sharedCharacterRevisionLabel: "Revision",
    sharedCharacterUpdatedLabel: "Updated at",
    sharedCharacterRevisionShort: (revision: number) => `rev. ${revision}`,
    sharedCharacterOpen: "Open character",
    deleteCharacter: "Remove from this device",
    delete: "Remove",
    deletePrompt: "To remove this character from this device, type exactly:",
    deleteDescription:
      "This removes the character from this device's list. The cloud version, shares, and copies on other devices are not deleted. If it exists only here, export a backup first to keep a copy.",
    settingsTitle: "Local settings",
    settingsDescription:
      "Manage preferences, this device's data, manual backups, and your account. Editing remains available offline.",
    cloudTitle: "Account and cloud",
    cloudDescription:
      "Account backups are manual. Characters with sync enabled update automatically and can be accessed from other devices.",
    cloudStatusSignedOut: "Sign-in required",
    cloudStatusSignedIn: "Signed in",
    cloudStatusCheckingSession: "Checking session",
    cloudStatusApiPending: "Cloud unavailable",
    cloudStatusOffline: "Offline",
    cloudSaveBackup: "Save cloud backup",
    cloudRestoreLatest: "Restore latest backup",
    cloudRefreshBackups: "Refresh list",
    cloudLastBackupLabel: "Last backup",
    cloudLastRestoreLabel: "Last restore",
    cloudNeverBackedUp: "No cloud backup yet.",
    cloudLastBackup: (date: string) => `Last backup: ${new Date(date).toLocaleString("en-US")}`,
    cloudLastRestore: (date: string) => new Date(date).toLocaleString("en-US"),
    cloudDeviceIdLabel: "Device",
    cloudAccountLabel: "Account",
    cloudOfflineHelp:
      "Connect to the internet to use synchronization, sharing, or cloud backups.",
    cloudLoginRequiredHelp:
      "Sign in to sync and share characters or save and restore backups. Local editing keeps working without login.",
    cloudSignedInHelp:
      "Characters with sync enabled update automatically. Backups remain manual and separate from the live character version.",
    cloudApiPendingHelp:
      "Synchronization, sharing, and cloud backups are not available in this environment. Your local data keeps working normally.",
    cloudWorking: "Working...",
    cloudPreparingBackup: "Saving local changes before backup...",
    cloudUploadingBackup: "Uploading backup to the cloud...",
    cloudBackupSavedWithCount: (characters: number) =>
      `Cloud backup saved with ${characters} character(s).`,
    cloudBackupDuplicate: "The latest backup already contains this data. Nothing new was uploaded.",
    cloudBackupsRefreshed: "Backup list refreshed.",
    cloudSaveLocalError:
      "Could not finish the local save before backup. Try again.",
    cloudSaveBackupError: "Could not save cloud backup.",
    cloudListBackupsError: "Could not load the backup list.",
    cloudRestoreLoading: "Loading cloud backup...",
    cloudRestoreApplying: "Merging cloud backup with your local data...",
    cloudRestoreThisBackup: "Restore",
    cloudRestoreMergeTitle: "Restore backup in merge mode",
    cloudRestoreMergeDescription:
      "Review the backup before merging. This mode adds/updates data from the backup without deleting local data that is not in it.",
    cloudRestoreRemoteBackup: "Cloud backup",
    cloudRestoreLocalData: "Current local data",
    cloudRestoreMergeKeepsLocal:
      "Local characters that do not exist in the backup remain on this device.",
    cloudRestoreMergeNotice:
      "Merge restore does not delete characters absent from the backup. Sync links and shares are not part of the backup and are not restored.",
    cloudRestoreMergeConfirm: "Merge backup",
    cloudRestoreReplaceStart: "Replace local data",
    cloudRestoreReplaceTitle: "Replace local data with cloud backup",
    cloudRestoreReplaceDescription:
      "This mode deletes the local data on this device and imports the selected backup contents.",
    cloudRestoreReplaceRemovesLocal:
      "Local characters that do not exist in the backup will be removed from this device.",
    cloudRestoreReplaceWarning:
      "Warning: this action replaces the characters and settings on this device. Sync links and shares are not part of the backup; imported characters return as local-only.",
    cloudRestoreExportLocalFirst: "Export local backup first",
    cloudRestoreReplacePrompt: "To confirm, type exactly:",
    cloudRestoreReplaceToken: "REPLACE",
    cloudRestoreReplaceConfirm: "Replace local data",
    cloudRestoreReplaceApplying: "Replacing local data with the cloud backup...",
    cloudRestoreSuccess: (characters: number, settings: number) =>
      `Backup restored in merge mode: ${characters} character(s) and ${settings} setting(s).`,
    cloudRestoreReplaceSuccess: (characters: number, settings: number) =>
      `Backup restored in replace mode: ${characters} character(s) and ${settings} setting(s).`,
    cloudRestoreError: "Could not restore the cloud backup.",
    cloudBackupListTitle: "Recent backups",
    cloudBackupListEmpty: "No backup found for this account.",
    cloudBackupSummary: (characters: number, appVersion: string) =>
      `${characters} character(s) • app ${appVersion}`,
    authAccountTitle: "Connected account",
    authLoginTitle: "Sign in",
    authRegisterTitle: "Create account",
    authLoginDescription:
      "Sign in to sync characters across devices, share them in read-only mode, and use manual backups. Local editing keeps working without login.",
    authRegisterDescription:
      "Create an account to sync characters across devices, share them in read-only mode, and keep manual backups. Your characters are still saved to this device first.",
    authSignedInDescription:
      "Your account is connected. Characters with sync enabled update automatically; backups remain manual and optional.",
    authEmail: "Email",
    authEmailPlaceholder: "you@example.com",
    authPassword: "Password",
    authPasswordPlaceholder: "Your password",
    authConfirmPassword: "Confirm password",
    authConfirmPasswordPlaceholder: "Type your password again",
    authDisplayName: "Display name",
    authDisplayNamePlaceholder: "How you want to appear",
    authPasswordHelp: "Use at least 8 characters. Your password is protected on the server and is never stored as plain text.",
    authLocalFirstNotice:
      "Your characters remain saved locally and available offline. Your account stores characters with sync enabled, their shares, and backups you send manually.",
    authModeTabsLabel: "Choose authentication mode",
    authNotAvailableTitle: "Cloud unavailable",
    authNotAvailableDescription:
      "Account, synchronization, sharing, and cloud backups are not available in this environment. You can still save a local profile to identify this device.",
    authSignIn: "Sign in",
    authCreateAccount: "Create account",
    authMissingFields: "Fill in email and password.",
    authEmailInvalid: "Enter a valid email address.",
    authPasswordTooShort: "Password must be at least 8 characters.",
    authPasswordMismatch: "Passwords do not match.",
    authSuccess: "Signed in successfully.",
    authLoginError: "Could not sign in.",
    authRegisterError: "Could not create the account.",
    authLogoutSuccess:
      "You signed out. Your local data remains on this device; sync and sharing stay unavailable until you sign in again.",
    authLogoutError: "Could not sign out.",
    requestId: "Request ID",
    appVersion: "App version",
    visualPreferences: "Visual preferences",
    visualPreferencesDescription:
      "Adjust theme and visual options saved locally on this device.",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    classDecorations: "Class decorations",
    classDecorationsHelp:
      "Turns optional visual identities based on the character class on or off.",
    localData: "Local data",
    exportData: "Export data",
    exportDescription:
      "Downloads a JSON file with local characters and settings. Account data, shares, sync links, and the pending queue are not included.",
    importData: "Import data",
    importDescription:
      "Import a JSON backup exported by this app. Imported characters return as local-only, without restoring sync links or shares.",
    importMode: "Import mode",
    mergeImport: "Merge with current data",
    replaceImport: "Replace all local data",
    chooseBackupFile: "Choose JSON file",
    clearData: "Clear local data",
    clearDataDescription:
      "Removes characters, pending changes, conflict drafts, and settings from this browser. Data already uploaded to the cloud and account backups are not deleted.",
    clearDataTitle: "Clear all data from this device?",
    clearDataPrompt: "To confirm, type exactly:",
    clearDataToken: "CLEAR",
    clearDataWarning:
      "This deletes this device's data, including changes that have not synced yet. Characters and backups already stored in the cloud remain in the account.",
    exportSuccess: "Backup exported successfully.",
    exportError: "Could not export local data.",
    importSuccess: (characters: number, settings: number) =>
      `Import finished: ${characters} character(s) and ${settings} setting(s).`,
    importError:
      "Could not import. Make sure the file is a valid JSON backup from this app.",
    clearSuccess: "This device's data was cleared. The cloud was not changed.",
    clearError: "Could not clear local data.",
    currentSummary: (characters: number) =>
      `${characters} active character(s) on this device.`,
    classes: {
      daggerheart: {
        sorcerer: "Sorcerer",
        druid: "Druid",
        ranger: "Ranger",
        warrior: "Warrior",
        guardian: "Guardian",
        seraph: "Seraph",
        wizard: "Wizard",
        bard: "Bard",
        rogue: "Rogue",
      },
    },
  },
} satisfies Record<Language, Record<string, unknown>>;

export function getSafeLanguage(value: unknown, fallback: Language): Language {
  return value === "pt-BR" || value === "en-US" ? value : fallback;
}
