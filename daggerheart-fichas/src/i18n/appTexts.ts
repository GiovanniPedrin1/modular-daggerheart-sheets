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
      "O app continua funcionando. Suas alterações seguem sendo salvas neste dispositivo.",
    loginTitle: "Conta",
    loginDescription:
      "Entre na sua conta para usar backup manual na nuvem. O app continua funcionando localmente sem login.",
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
    cloudSyncActive: "Sync ativo",
    cloudSyncStatusLabel: "Status da sincronização",
    cloudSyncStatusLocal: "Somente local",
    cloudSyncStatusLocalHelp:
      "Esta ficha está salva apenas neste dispositivo.",
    cloudSyncStatusSyncing: "Enviando...",
    cloudSyncStatusSyncingHelp:
      "A ficha está sendo publicada e vinculada à nuvem.",
    cloudSyncStatusSynced: "Sincronizada",
    cloudSyncStatusSyncedHelp:
      "O snapshot local corresponde à última revisão salva na nuvem.",
    cloudSyncStatusQueued: "Alterações pendentes",
    cloudSyncStatusQueuedHelp:
      "Há alterações locais posteriores ao último snapshot salvo na nuvem.",
    cloudSyncStatusConflict: "Conflito",
    cloudSyncStatusConflictHelp:
      "A ficha precisa de revisão antes de novas alterações serem enviadas.",
    cloudSyncStatusReadonly: "Somente leitura",
    cloudSyncStatusReadonlyHelp:
      "Esta ficha pode ser visualizada, mas não editada neste dispositivo.",
    cloudSyncStatusRevision: (revision: number) => `rev. ${revision}`,
    cloudSyncActivateHelp:
      "Publica esta ficha na sua conta e vincula este dispositivo à versão na nuvem.",
    cloudSyncActiveHelp:
      "Esta ficha já está vinculada a uma versão viva na nuvem.",
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
    deleteCharacter: "Apagar personagem",
    delete: "Apagar",
    deletePrompt: "Para apagar este personagem, digite exatamente:",
    deleteDescription:
      "Essa ação remove o personagem da lista deste dispositivo. Exporte um backup antes se quiser manter uma cópia.",
    settingsTitle: "Configurações locais",
    settingsDescription:
      "Gerencie dados locais, preferências e backups. O app continua funcionando offline; recursos de nuvem são opcionais.",
    cloudTitle: "Nuvem",
    cloudDescription:
      "Salve manualmente uma cópia das suas fichas na sua conta sem deixar de usar o app offline.",
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
    cloudOfflineHelp: "Conecte-se à internet para usar backup na nuvem.",
    cloudLoginRequiredHelp:
      "Entre na sua conta para salvar ou restaurar backups na nuvem. O app local continua funcionando sem login.",
    cloudSignedInHelp:
      "Backups são manuais. Suas alterações continuam salvas primeiro neste dispositivo.",
    cloudApiPendingHelp:
      "O backup na nuvem não está disponível neste ambiente. Seus dados locais continuam funcionando normalmente.",
    cloudWorking: "Processando...",
    cloudPreparingBackup: "Salvando alterações locais antes do backup...",
    cloudUploadingBackup: "Enviando backup para a nuvem...",
    cloudBackupSaved: "Backup salvo na nuvem com sucesso.",
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
      "A restauração em modo mesclar não apaga seus dados locais. Metadados deste dispositivo e da conta atual serão preservados.",
    cloudRestoreMergeConfirm: "Mesclar backup",
    cloudRestoreReplaceStart: "Substituir dados locais",
    cloudRestoreReplaceTitle: "Substituir dados locais por backup da nuvem",
    cloudRestoreReplaceDescription:
      "Este modo apaga os dados locais deste dispositivo e importa o conteúdo do backup selecionado.",
    cloudRestoreReplaceRemovesLocal:
      "Personagens locais que não existem no backup serão removidos deste dispositivo.",
    cloudRestoreReplaceWarning:
      "Atenção: esta ação substitui os personagens e configurações locais. Exporte um backup local antes de continuar se quiser manter uma cópia.",
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
    authDescription:
      "Backup na nuvem é opcional. Suas fichas continuam disponíveis neste dispositivo e offline.",
    authLoginDescription:
      "Entre para salvar backups manuais na nuvem. A edição local continua funcionando sem login.",
    authRegisterDescription:
      "Crie uma conta para proteger seus backups na nuvem. Suas fichas continuam salvas primeiro neste dispositivo.",
    authSignedInDescription:
      "Sua conta está conectada. Backups continuam sendo uma ação manual e opcional.",
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
      "Suas fichas continuam salvas localmente e disponíveis offline. A nuvem guarda apenas backups enviados por você.",
    authModeTabsLabel: "Escolher modo de autenticação",
    authNotAvailableTitle: "Nuvem não configurada",
    authNotAvailableDescription:
      "O backup na nuvem não está disponível neste ambiente. Você ainda pode salvar um perfil local para identificar este dispositivo.",
    authSignIn: "Entrar",
    authCreateAccount: "Criar conta",
    authSwitchToRegister: "Criar conta",
    authSwitchToLogin: "Já tenho conta",
    authMissingFields: "Preencha email e senha.",
    authEmailInvalid: "Digite um email válido.",
    authPasswordTooShort: "A senha precisa ter pelo menos 8 caracteres.",
    authPasswordMismatch: "As senhas não conferem.",
    authSuccess: "Sessão iniciada com sucesso.",
    authLoginError: "Não foi possível entrar na conta.",
    authRegisterError: "Não foi possível criar a conta.",
    authLogoutSuccess: "Você saiu da conta. Seus dados locais continuam neste dispositivo.",
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
      "Baixa um arquivo JSON com personagens, configurações e versão do formato para backup manual.",
    importData: "Importar dados",
    importDescription:
      "Importe um backup JSON exportado por este app. Valide o arquivo antes de substituir seus dados.",
    importMode: "Modo de importação",
    mergeImport: "Mesclar com dados atuais",
    replaceImport: "Substituir todos os dados locais",
    chooseBackupFile: "Escolher arquivo JSON",
    clearData: "Limpar dados locais",
    clearDataDescription:
      "Remove personagens e configurações deste navegador. Use exportar antes se quiser guardar backup.",
    clearDataTitle: "Limpar todos os dados locais?",
    clearDataPrompt: "Para confirmar, digite exatamente:",
    clearDataToken: "LIMPAR",
    clearDataWarning:
      "Essa ação apaga personagens e configurações salvos neste dispositivo. Ela não pode ser desfeita pelo app.",
    exportSuccess: "Backup exportado com sucesso.",
    exportError: "Não foi possível exportar os dados locais.",
    importSuccess: (characters: number, settings: number) =>
      `Importação concluída: ${characters} personagem(ns) e ${settings} configuração(ões).`,
    importError:
      "Não foi possível importar. Verifique se o arquivo é um backup JSON válido deste app.",
    clearSuccess: "Dados locais apagados.",
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
      "The app keeps working. Your changes continue being saved on this device.",
    loginTitle: "Account",
    loginDescription:
      "Sign in to use manual cloud backup. The app keeps working locally without login.",
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
    cloudSyncActive: "Sync active",
    cloudSyncStatusLabel: "Sync status",
    cloudSyncStatusLocal: "Local only",
    cloudSyncStatusLocalHelp:
      "This character is saved only on this device.",
    cloudSyncStatusSyncing: "Uploading...",
    cloudSyncStatusSyncingHelp:
      "The character is being published and linked to the cloud.",
    cloudSyncStatusSynced: "Synced",
    cloudSyncStatusSyncedHelp:
      "The local snapshot matches the latest revision saved in the cloud.",
    cloudSyncStatusQueued: "Changes pending",
    cloudSyncStatusQueuedHelp:
      "There are local changes newer than the last snapshot saved in the cloud.",
    cloudSyncStatusConflict: "Conflict",
    cloudSyncStatusConflictHelp:
      "The character needs review before more changes can be uploaded.",
    cloudSyncStatusReadonly: "Read only",
    cloudSyncStatusReadonlyHelp:
      "This character can be viewed but not edited on this device.",
    cloudSyncStatusRevision: (revision: number) => `rev. ${revision}`,
    cloudSyncActivateHelp:
      "Publishes this character to your account and links this device to the cloud version.",
    cloudSyncActiveHelp:
      "This character is already linked to a live cloud version.",
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
    deleteCharacter: "Delete character",
    delete: "Delete",
    deletePrompt: "To delete this character, type exactly:",
    deleteDescription:
      "This removes the character from this device's list. Export a backup first if you want to keep a copy.",
    settingsTitle: "Local settings",
    settingsDescription:
      "Manage local data, preferences, and backups. The app keeps working offline; cloud features are optional.",
    cloudTitle: "Cloud",
    cloudDescription:
      "Manually save a copy of your sheets to your account without losing offline access.",
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
    cloudOfflineHelp: "Connect to the internet to use cloud backup.",
    cloudLoginRequiredHelp:
      "Sign in to save or restore cloud backups. The local app keeps working without login.",
    cloudSignedInHelp:
      "Backups are manual. Your changes are still saved to this device first.",
    cloudApiPendingHelp:
      "Cloud backup is not available in this environment. Your local data keeps working normally.",
    cloudWorking: "Working...",
    cloudPreparingBackup: "Saving local changes before backup...",
    cloudUploadingBackup: "Uploading backup to the cloud...",
    cloudBackupSaved: "Cloud backup saved successfully.",
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
      "Merge restore does not delete your local data. This device's metadata and current account hint will be preserved.",
    cloudRestoreMergeConfirm: "Merge backup",
    cloudRestoreReplaceStart: "Replace local data",
    cloudRestoreReplaceTitle: "Replace local data with cloud backup",
    cloudRestoreReplaceDescription:
      "This mode deletes the local data on this device and imports the selected backup contents.",
    cloudRestoreReplaceRemovesLocal:
      "Local characters that do not exist in the backup will be removed from this device.",
    cloudRestoreReplaceWarning:
      "Warning: this action replaces local characters and settings. Export a local backup before continuing if you want to keep a copy.",
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
    authDescription:
      "Cloud backup is optional. Your sheets remain available on this device and offline.",
    authLoginDescription:
      "Sign in to save manual cloud backups. Local editing keeps working without login.",
    authRegisterDescription:
      "Create an account to protect your cloud backups. Your sheets are still saved to this device first.",
    authSignedInDescription:
      "Your account is connected. Backups are still manual and optional.",
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
      "Your sheets remain saved locally and available offline. The cloud stores only backups you send manually.",
    authModeTabsLabel: "Choose authentication mode",
    authNotAvailableTitle: "Cloud unavailable",
    authNotAvailableDescription:
      "Cloud backup is not available in this environment. You can still save a local profile to identify this device.",
    authSignIn: "Sign in",
    authCreateAccount: "Create account",
    authSwitchToRegister: "Create account",
    authSwitchToLogin: "I already have an account",
    authMissingFields: "Fill in email and password.",
    authEmailInvalid: "Enter a valid email address.",
    authPasswordTooShort: "Password must be at least 8 characters.",
    authPasswordMismatch: "Passwords do not match.",
    authSuccess: "Signed in successfully.",
    authLoginError: "Could not sign in.",
    authRegisterError: "Could not create the account.",
    authLogoutSuccess: "You signed out. Your local data remains on this device.",
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
      "Downloads a JSON file with characters, settings, and format version for manual backup.",
    importData: "Import data",
    importDescription:
      "Import a JSON backup exported by this app. Validate the file before replacing your data.",
    importMode: "Import mode",
    mergeImport: "Merge with current data",
    replaceImport: "Replace all local data",
    chooseBackupFile: "Choose JSON file",
    clearData: "Clear local data",
    clearDataDescription:
      "Removes characters and settings from this browser. Export first if you want to keep a backup.",
    clearDataTitle: "Clear all local data?",
    clearDataPrompt: "To confirm, type exactly:",
    clearDataToken: "CLEAR",
    clearDataWarning:
      "This deletes characters and settings saved on this device. It cannot be undone by the app.",
    exportSuccess: "Backup exported successfully.",
    exportError: "Could not export local data.",
    importSuccess: (characters: number, settings: number) =>
      `Import finished: ${characters} character(s) and ${settings} setting(s).`,
    importError:
      "Could not import. Make sure the file is a valid JSON backup from this app.",
    clearSuccess: "Local data cleared.",
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
