// 🧲 v0.154: a ordem do painel — UMA lista só, para todo mundo.
//
// As ferramentas, as abas e as colunas do painel podem ser reordenadas em
// 🎨 Temas → 🧲 Organizar o painel. Até a v0.153 a lista do que existe vivia
// em TRÊS lugares — o sanitizador do servidor, o painel e a prévia das
// configurações — e um recurso novo precisava entrar nos três. Quando um
// deles ficava para trás (foi o caso da 🎞️ Mídia direta, que nunca entrou
// no servidor), a chave era descartada ao salvar e o botão voltava sempre
// para o fim da fila, sem o usuário entender por quê.
//
// Este arquivo é a única fonte: o servidor o carrega com require() e as
// páginas com <script>. Recurso novo entra AQUI, uma vez, e passa a valer
// em todo lugar. A ordem destas listas é a ordem padrão de quem nunca
// arrastou nada.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module && module.exports) module.exports = mod;
  else raiz.OBS_PAINEL_ORDEM = mod;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Ferramentas (os ícones da barra). A chave é o prefixo do id do botão no
  // painel: qr → #qrToolBtn, midiaDireta → #midiaDiretaToolBtn…
  const FERRAMENTAS = ['qr', 'raffle', 'likemeter', 'aud', 'ws', 'aviso', 'midiaDireta', 'trilhas', 'obs', 'vmix', 'clip'];

  // Abas (data-tab de cada botão .tab do painel)
  const ABAS = ['live', 'saved', 'superchat', 'member', 'whatsapp', 'telegram', 'apoio'];

  // Colunas do modo «por rede» (a coluna sintética «__all» é do painel e é
  // aceita à parte, porque não é uma rede)
  const COLUNAS = ['youtube', 'twitch', 'kick', 'bilibili', 'telegram', 'whatsapp', 'doacao'];

  // Mantém só chaves conhecidas, sem repetição, na ordem em que vieram
  function soConhecidas(lista, padrao) {
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.filter((k) => padrao.includes(k)))];
  }

  // A ordem que vale: primeiro o que o usuário salvou, depois o que ele ainda
  // não conhece (recurso novo), na ordem padrão — e nada que não exista mais
  function mesclar(salvo, padrao) {
    return [...new Set([...soConhecidas(salvo, padrao), ...padrao])];
  }

  // 📋 A Área de transferência fecha a fila por padrão: um botão novo entra
  // ANTES dela. Só fica depois se o usuário a tirou do fim de propósito.
  function ordenarFerramentas(salvo) {
    const salvoArr = soConhecidas(salvo, FERRAMENTAS);
    const ordem = mesclar(salvoArr, FERRAMENTAS);
    const moveuClip = salvoArr.includes('clip') && salvoArr[salvoArr.length - 1] !== 'clip';
    if (!moveuClip && ordem.includes('clip')) {
      ordem.splice(ordem.indexOf('clip'), 1);
      ordem.push('clip');
    }
    return ordem;
  }

  function ordenarAbas(salvo) {
    return mesclar(salvo, ABAS);
  }

  return { FERRAMENTAS, ABAS, COLUNAS, soConhecidas, mesclar, ordenarFerramentas, ordenarAbas };
});
