import type { DaggerheartCompanionPage, Localized, LocalizedString } from "../types";

const l = (pt: string, en: string): LocalizedString => ({ "pt-BR": pt, "en-US": en });
const list = (pt: string[], en: string[]): Localized<string[]> => ({ "pt-BR": pt, "en-US": en });

export const rangerCompanion: DaggerheartCompanionPage = {
  evasionStart: 10,
  intro: l(
    "Trabalhe com o GM para decidir que tipo de animal você tem como companheiro. Dê um nome a ele e desenhe ou anexe uma imagem no espaço acima. Depois, crie duas Experiências para seu companheiro com base no treinamento dele e na história que vocês têm juntos. Por fim, descreva o método que ele usa para causar dano, seu ataque padrão, e registre na seção de Ataque & Dano. O dano começa em d6 e o alcance começa em Corpo a corpo.",
    "Work with the GM to decide what kind of animal you have as your companion. Give them a name and draw or attach a picture of them in the space above. Then create two Experiences for your companion based on their training and the history you have together. Finally, describe their method of dealing damage (their standard attack) and record it in the Attack & Damage section. Their damage starts at d6 and their range starts at Melee."
  ),
  experienceDescription: l(
    "Comece com +2 em duas Experiências. Sempre que você ganhar uma nova Experiência, seu companheiro também ganha uma. Todas as novas Experiências começam em +2.",
    "Start with +2 in two Experiences. Whenever you gain a new Experience, your companion also gains one. All new Experiences start at +2."
  ),
  exampleExperiences: list(
    [
      "Distração Ousada",
      "Escalador Especialista",
      "Buscar",
      "Amigável",
      "Guardião da Floresta",
      "Aterrorizante",
      "Intimidador",
      "Leal Até o Fim",
      "Navegação",
      "Ágil",
      "Ninguém Fica para Trás",
      "Sempre em Alerta",
      "Protetor",
      "Companheiro Real",
      "Batedor",
      "Animal de Serviço",
      "Montaria de Confiança",
      "Vigilante",
      "Nós Sempre os Encontramos",
      "Você Não Acerta o que Não Consegue Encontrar",
    ],
    [
      "Bold Distraction",
      "Expert Climber",
      "Fetch",
      "Friendly",
      "Guardian of the Forest",
      "Horrifying",
      "Intimidating",
      "Loyal Until the End",
      "Navigation",
      "Nimble",
      "Nobody Left Behind",
      "On High Alert",
      "Protective",
      "Royal Companion",
      "Scout",
      "Service Animal",
      "Trusted Mount",
      "Vigilant",
      "We Always Find Them",
      "You Can’t Hit What You Can’t Find",
    ]
  ),
  commandDescription: l(
    "Faça uma Rolagem de Spellcast para se conectar com seu companheiro e comandá-lo a agir. Gaste 1 Hope para adicionar uma Experiência de Companheiro aplicável à rolagem. Em um sucesso com Hope, se sua próxima ação se basear no sucesso dele, você ganha vantagem na rolagem.",
    "Make a Spellcast Roll to connect with your companion and command them to take action. Spend a Hope to add an applicable Companion Experience to the roll. On a success with Hope, if your next action builds on their success, you gain advantage on the roll."
  ),
  attackDescription: l(
    "Quando você comanda seu companheiro a atacar, ele ganha quaisquer benefícios que normalmente se aplicariam apenas a você, como os efeitos de Foco do Ranger. Em um sucesso, a rolagem de dano dele usa sua Proficiência e o dado de dano dele.",
    "When you command your companion to attack, they gain any benefits that would normally only apply to you (such as the effects of Ranger’s Focus). On a success, their damage roll uses your Proficiency and their damage die."
  ),
  stressDescription: l(
    "Quando seu companheiro sofreria qualquer quantidade de dano, ele marca 1 Stress. Quando marca seu último Stress, ele sai de cena, escondendo-se, fugindo ou fazendo algo semelhante. Ele permanece indisponível até o início do seu próximo descanso longo, quando retorna com 1 Stress limpo. Quando você escolhe um movimento de descanso que limpa Stress em você, seu companheiro limpa a mesma quantidade de Stress.",
    "When your companion would take any amount of damage, they mark a Stress. When they mark their last Stress, they drop out of the scene (by hiding, fleeing, or a similar action). They remain unavailable until the start of your next long rest, where they return with 1 Stress cleared. When you choose a downtime move that clears Stress on yourself, your companion clears an equal number of Stress."
  ),
  trainingIntro: l(
    "Quando seu personagem sobe de nível, escolha uma opção disponível para seu companheiro na lista a seguir e marque-a aqui.",
    "When your character levels up, choose one available option for your companion from the following list and mark it here."
  ),
  trainingOptions: [
    {
      key: "intelligent",
      title: l("Inteligente", "Intelligent"),
      description: l(
        "Seu companheiro ganha +1 de bônus permanente em uma Experiência de Companheiro à sua escolha.",
        "Your companion gains a permanent +1 bonus to a Companion Experience of your choice."
      ),
      slots: 3,
    },
    {
      key: "light_in_the_dark",
      title: l("Luz na Escuridão", "Light in the Dark"),
      description: l(
        "Use isto como um slot de Hope adicional que seu personagem pode marcar.",
        "Use this as an additional Hope slot your character can mark."
      ),
      hopeSlot: true,
    },
    {
      key: "creature_comfort",
      title: l("Conforto Animal", "Creature Comfort"),
      description: l(
        "Uma vez por descanso, quando você passa um tempo em um momento calmo dando carinho e atenção ao seu companheiro, você pode ganhar 1 Hope ou ambos podem limpar 1 Stress.",
        "Once per rest, when you take time during a quiet moment to give your companion love and attention, you can gain a Hope or you can both clear a Stress."
      ),
    },
    {
      key: "armored",
      title: l("Encouraçado", "Armored"),
      description: l(
        "Quando seu companheiro sofre dano, você pode marcar um dos seus Slots de Armadura em vez de marcar um dos Stress dele.",
        "When your companion takes damage, you can mark one of your Armor Slots instead of marking one of their Stress."
      ),
    },
    {
      key: "vicious",
      title: l("Feroz", "Vicious"),
      description: l(
        "Aumente o dado de dano ou o alcance do seu companheiro em um passo, como d6 para d8 ou Close para Far.",
        "Increase your companion’s damage dice or range by one step (d6 to d8, Close to Far, etc.)."
      ),
      slots: 3,
    },
    {
      key: "resilient",
      title: l("Resiliente", "Resilient"),
      description: l(
        "Seu companheiro ganha um slot de Stress adicional.",
        "Your companion gains an additional Stress slot."
      ),
      slots: 3,
    },
    {
      key: "bonded",
      title: l("Vinculado", "Bonded"),
      description: l(
        "Quando você marca seu último Ponto de Vida, seu companheiro corre para o seu lado para confortá-lo. Role uma quantidade de d6 igual aos slots de Stress desmarcados que ele tem e marque esses slots. Se qualquer dado rolar 6, seu companheiro ajuda você a se levantar. Limpe seu último Ponto de Vida e retorne à cena.",
        "When you mark your last Hit Point, your companion rushes to your side to comfort you. Roll a number of d6s equal to the unmarked Stress slots they have and mark them. If any roll a 6, your companion helps you up. Clear your last Hit Point and return to the scene."
      ),
    },
    {
      key: "aware",
      title: l("Atento", "Aware"),
      description: l(
        "Seu companheiro ganha +2 de bônus permanente na Evasão dele.",
        "Your companion gains a permanent +2 bonus to their Evasion."
      ),
      slots: 3,
    },
  ],
};
