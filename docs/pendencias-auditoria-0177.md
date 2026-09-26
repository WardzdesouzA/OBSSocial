# Pendências da checagem de segurança e bugs (auditoria da v0.177.0)

A auditoria completa foi interrompida a pedido; a v0.177.0 fechou o que estava pronto. O que ficou
para as próximas versões (achados relatados pelos testadores, ainda **sem verificação independente**):

## Segurança (lentes sem integração: dos-robustez, egress-exec, connectors-parse)
- Rodar essas três lentes e a verificação adversarial dos achados já corrigidos (foram corrigidos pelas evidências dos finders).

## Painel — ferramentas e tela
- ⏱️ Tempo de tela do destaque só acontece na tela: servidor e painel continuam «no ar» e um F5 na fonte do OBS traz o destaque expirado de volta.
- 🧪 Exemplo da audiência some da tela em até 10 s (o poll de audiência apaga as redes de exemplo).
- 📢 Clicar 👁️ com o aviso vazio deixa o painel em «Tirar da tela» sem nada na tela.
- Confirmar um diálogo (remover QR, zerar winstreak, limpar histórico) fecha o popover da ferramenta.
- Dica do ✖ Limpar tela desatualizada (não cita avisos, audiência, avatar, relógio, clima e mídia).
- Relógio no overlay: data sempre em pt-BR; rótulos «Cronômetro»/«Timer» fixos.
- Animação «Deslizar de baixo» (destaque) e «Deslizar de cima» (aviso) voltam para «Aparecer suave» a cada salvamento (migração antiga em `mergeSettings`).
- Mudar qualquer configuração com áudio do inscrito tocando reinicia e pausa o áudio na tela.
- Mídia sem duração conhecida termina na tela, mas o painel fica «tocando» para sempre.
- Tela do OBS aberta em outra máquina da rede (viewer): avisos que a tela manda ao servidor (fim de vídeo, momentos de áudio) são descartados.
- 🧹 limpar a tela não zera o player da mídia no servidor.

## Rede e papéis
- Painel/config/deck derrubados por senha nova ficam «mortos» (reconectando em loop com 401, sem tela de senha).
- config.html pela rede mostra o diálogo «Só no computador do OBS Social» sem clique (o `kickNavegador` do init é local-only).
- Card de segurança em 🔗 URLs pela rede (papel full) fica editável e mente depois da recusa.
- «Máquinas conectadas agora» fica em «carregando...» pela rede.
- Modo espectador: botões que o servidor vai negar continuam ativos e o clique morre em silêncio; a faixa «Modo espectador» não some quando a restrição é desligada.
- Logins certos contam para o bloqueio de força bruta (8 entradas corretas do mesmo IP em 10 min bloqueiam a 9ª).
- Textos apontam para uma «aba 🔒 Segurança» que não existe (é 🔗 URLs para o OBS); README/hint dizem que a senha vale mesmo com «liberdade total».
- Tela de senha só em português.

## Idiomas
- Overlay traduz o que o espectador/streamer escreveu (nome no pódio, avatar ampliado, texto do aviso, nome do QR) — precisa de `data-no-i18n`.
- Página de login sem o motor de idiomas.
- 🕹️ Controle Externo: 45 itens do catálogo (mídia direta, clima, apagar testes) em português nos 9 idiomas.
- Popover 🕐: fileira de modos não cabe em espanhol, francês e turco.
- Janela preta: «Recuperei N comentários do log de hoje» sempre em português.
- Chinês (zh): os 180 textos + 19 padrões novos da v0.177 ainda sem tradução (os outros 8 idiomas receberam).
- Revisão humana das traduções novas (foram feitas por tradutor automático sem a etapa de revisão).

## Áreas não exercitadas pela auditoria funcional
chat fixo, config (conexões, visual, dados), Labs/integrações, deck/controle externo, servidor/conectores.
