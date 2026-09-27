# Pendências da checagem geral (depois da v0.179.0)

A checagem geral pedida na v0.177 foi concluída na v0.179.0: os achados funcionais pendentes foram
verificados por reprodução independente e corrigidos, as três lentes de segurança que faltavam rodaram,
as correções de segurança da v0.177 foram reverificadas por atacantes e completadas, as áreas nunca
exercitadas (chat fixo, configurações, Labs, deck/controle externo, servidor/conectores) foram auditadas
e corrigidas, e o chinês recebeu o que faltava desde a v0.177. O que ficou para as próximas versões:

## Segurança (registrado pelos revisores, sem correção nesta versão)
- 🕹️ O token do controle externo dá papel «full» completo pela rede (é por desenho; hint, FAQ e README
  passaram a dizer isso). Se um dia for preciso um token só de atalhos, será um recurso novo.
- Modo túnel (`OBS_SOCIAL_EXIGIR_SENHA_LOCAL=1`): todos os usuários chegam como 127.0.0.1 e dividem o
  mesmo teto de 24 conexões e os mesmos respiros por IP — um usuário pode atrapalhar o outro.
- Respiros por conexão (mídia direta, buscas de saída): o teto real de amplificação é 24× o respiro
  (24 conexões por IP). Um respiro por IP para essas operações seria mais justo.
- `chat.platforms` e `selos.ocultos` ainda aceitam chaves desconhecidas (até ~400 KB por mensagem; não
  acumulam entre mensagens e o teto de 2 MB segura o total). Podar às redes/selos conhecidos.
- O «canal» digitado para o WhatsApp (id do grupo) vai a todos os papéis em `init.connections`/`status`;
  se alguém digitar um número de contato ali, ele chega ao viewer. Mascarar com `pareceTelefoneSrv`.
- Lacunas do crítico não exercitadas: caminho ao vivo da Bilibili (wss danmaku, reconexão, respostas
  hostis), `deck.html` (XSS/estado, fluxo do token/QR), `responderInscrito` (chatId/replyTo crus, limite
  de taxa — só papel full), tempestade de reconexão com `recarregarMin` + muitas redes.
- vMix: o segundo portão do coringa «funcao» (lista `VMIX_FUNCOES_DISCO`) ficou como defesa em
  profundidade, hoje inalcançável (o viewer é barrado antes).

## Painel, tela e conexões
- YouTube: reconectar à MESMA live pelo link (em vez do @) não apaga nada, mas as mensagens antigas ficam
  carimbadas com a forma anterior da conta; ao REINICIAR com o link lembrado, `restoreFromLog` deixa as
  da forma antiga só no log. Resolver a conta para uma chave única (id da live) antes de carimbar.
- Modo espectador: o aviso «Modo espectador» também aparece para operações que a página manda sozinha
  se isso cair até 2,5 s depois de um clique (ex.: relógio do player). `testLimpar` não tem categoria em
  `OP_CATEGORY`, então é negado ao espectador mesmo com 🖥️ liberado (enquanto `test` é liberado).
- Tempo de tela do destaque: mudar o ⏱️ com um destaque já no ar não vale para esse destaque (o relógio é
  armado no `feature`); mandar o mesmo comentário de novo reinicia o relógio.
- No modo restrito sem 🖥️, uma tela aberta pela rede que avisa `midiaPlayerFim` é aceita (é aviso de
  retorno), mas qualquer aparelho da rede também consegue mandar esses avisos com um id visível no init
  (risco residual aceito: só fecham o que já está no ar).
- `audienceTest` (🧰): um número de mentira mandado pelo gancho fica no ar até «Tirar da tela» ou reinício.
- O teste `uitest179-viewer-avisos-tela` cria um alias de IP (10.99.0.2) e só roda como root.

## Idiomas
- Concordância numérica nos modelos estáticos do russo («2 баллов», «клавиш(а/и)», «шаблон(а/ов)») — só
  com plural por função no motor.
- Terminologia mista nos dicionários antigos (não nos blocos novos): «Mesa de trilhas», «destaque»,
  «painel», «rede», aspas «»/“”/「」 variam dentro do mesmo idioma (fr, de, ru, tr, ja, ko, zh). Um passe
  de unificação por idioma.
- ko: «Transcrição local» está como «로컬 필사» em 11 lugares (필사 é copiar à mão; áudio→texto é
  전사/받아쓰기). ja: a interface oficial da Twitch usa «交換» para o resgate (o dicionário usa «引き換え»).
- es (305) e en (116) têm entradas com tradução igual à chave — nem todas são nomes próprios.
- Fragmentos concatenados em tempo de execução («Pela» + «API oficial» + «da LivePix…», «…Com a» +
  «troca automática» + «ligada, …») ficam frágeis em japonês/coreano/chinês (ordem da frase).

## Documentação
- A resposta do FAQ sobre a tela cheia do editor, a moldura e o modo de tela pode ganhar uma linha sobre o
  comportamento novo (o editor acompanha na hora).
