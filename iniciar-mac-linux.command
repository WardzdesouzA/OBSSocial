#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ERRO: O Node.js não está instalado neste computador."
  echo "  Baixe e instale em: https://nodejs.org (botão verde \"LTS\")"
  echo "  Depois abra este arquivo de novo."
  echo ""
  read -r -p "Aperte Enter para fechar..."
  exit 1
fi
# Os componentes já vêm juntos no download; o npm só roda se a pasta sumir.
if [ ! -d node_modules/ws ]; then
  echo "Instalando componentes, aguarde..."
  npm install || npm install
  if [ ! -d node_modules/ws ]; then
    echo ""
    echo "  ERRO: Não consegui baixar os componentes (antivírus/proxy?)."
    echo "  Baixe o projeto de novo pelo GitHub — o ZIP já vem com tudo incluso."
    echo ""
    read -r -p "Aperte Enter para fechar..."
    exit 1
  fi
fi
# Reinícios e atualizações reusam esta mesma janela (código 10 = reabrir)
export OBS_SOCIAL_BAT=1
while :; do
  node server.js
  code=$?
  [ "$code" = "10" ] && continue
  break
done
