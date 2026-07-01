import type { Language } from "../sheets/daggerheart/types";

export const appTexts = {
  "pt-BR": {
    createCharacter: "Criar personagem",
    selectCharacter: "Selecionar personagem",
    language: "Idioma",
    login: "Login",
    logout: "Sair",
    settings: "Configurações",
    onlineStatus: "Online",
    offlineStatus: "Offline",
    offlineBannerTitle: "Você está offline",
    offlineBannerDescription:
      "O app continua funcionando. Suas alterações seguem sendo salvas neste dispositivo.",
    loginTitle: "Login",
    loginDescription:
      "Login e sincronização em nuvem serão adicionados em uma versão futura. No momento, seus personagens estão salvos apenas neste dispositivo.",
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
    deleteCharacter: "Apagar personagem",
    delete: "Apagar",
    deletePrompt: "Para apagar este personagem, digite exatamente:",
    deleteDescription:
      "Essa ação remove o personagem da lista deste dispositivo. No futuro, será possível recuperar personagens deletados.",
    settingsTitle: "Configurações locais",
    settingsDescription:
      "Gerencie backups e dados salvos neste navegador. Tudo aqui funciona sem backend ou login.",
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
    login: "Login",
    logout: "Logout",
    settings: "Settings",
    onlineStatus: "Online",
    offlineStatus: "Offline",
    offlineBannerTitle: "You are offline",
    offlineBannerDescription:
      "The app keeps working. Your changes continue being saved on this device.",
    loginTitle: "Login",
    loginDescription:
      "Login and cloud sync will be added in a future version. For now, your characters are saved only on this device.",
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
    deleteCharacter: "Delete character",
    delete: "Delete",
    deletePrompt: "To delete this character, type exactly:",
    deleteDescription:
      "This removes the character from this device's list. In the future, it will be possible to recover deleted characters.",
    settingsTitle: "Local settings",
    settingsDescription:
      "Manage backups and data saved in this browser. Everything here works without backend or login.",
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
