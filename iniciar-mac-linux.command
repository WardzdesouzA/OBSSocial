#!/bin/bash
cd "$(dirname "$0")" || exit 1

# ---------------------------------------------------------------------------
# Node.js é o motor que executa o programa — e a única coisa que não vem no
# ZIP: é instalado pelo instalador oficial do nodejs.org (ou pelo gerenciador
# de pacotes do sistema). Este script só confere se ele existe e serve (versão
# 18 ou mais nova) e, se não, explica o que fazer. De propósito, ele NÃO baixa
# nem executa programas da internet: esse é justamente o comportamento que faz
# antivírus bloquearem um programa. (A única rede que ele usa é o npm, que vem
# com o Node.js, para repor os dois componentes se a pasta node_modules sumir.)
# Quem não pode instalar programas pode usar uma cópia portátil: a pasta
# "node-portable" (com bin/node dentro), ao lado deste arquivo.
# ---------------------------------------------------------------------------
NODE_MIN=18
NODE_PORTATIL="$PWD/node-portable"

esperar_fechar() { echo ""; read -r -p "Aperte Enter para fechar..."; }

# Há um Node.js que serve (versão NODE_MIN ou mais nova) no PATH?
node_serve() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MIN ? 0 : 1)" >/dev/null 2>&1
}

abrir_site() {
  # xdg-open primeiro: em Debian/Ubuntu existe um «open» que não é o do Mac (openvt)
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "https://nodejs.org/" >/dev/null 2>&1
  elif [ "$(uname -s)" = Darwin ] && command -v open >/dev/null 2>&1; then open "https://nodejs.org/" >/dev/null 2>&1
  fi
}

if ! node_serve && [ -x "$NODE_PORTATIL/bin/node" ]; then
  export PATH="$NODE_PORTATIL/bin:$PATH"
fi
# Node instalado por nvm/fnm/Volta/Homebrew só entra no PATH dentro do Terminal;
# um duplo clique não passa por ele — então tenta os lugares de costume.
# (OBS_SOCIAL_NODE_LUGARES, separado por «:», troca a lista — só para testes.)
if ! node_serve; then
  if [ -n "${OBS_SOCIAL_NODE_LUGARES-}" ]; then IFS=: read -r -a lugares <<< "$OBS_SOCIAL_NODE_LUGARES"
  else lugares=("$HOME/.nvm/versions/node"/*/bin "$HOME/.volta/bin" "$HOME/.local/share/fnm/aliases/default/bin" /opt/homebrew/bin /usr/local/bin); fi
  for d in "${lugares[@]}"; do
    [ -x "$d/node" ] || continue
    if "$d/node" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MIN ? 0 : 1)" >/dev/null 2>&1; then
      export PATH="$d:$PATH"; break
    fi
  done
fi
if ! node_serve; then
  ver=$(node -v 2>/dev/null)
  echo ""
  if [ -n "$ver" ]; then
    echo "  O Node.js deste computador é antigo demais ($ver): o OBS Social precisa da"
    echo "  versão $NODE_MIN ou mais nova."
  else
    echo "  O Node.js (o motor que executa o programa) não está instalado neste computador."
    echo "  É a única coisa que não vem no ZIP, e instala em 1 minuto."
  fi
  echo ""
  echo "  Como resolver: entre em https://nodejs.org , clique no botão verde \"LTS\", instale"
  echo "  como qualquer programa e abra este arquivo de novo. (No Linux, também serve o"
  echo "  gerenciador de pacotes da sua distribuição, desde que entregue a versão $NODE_MIN ou mais nova.)"
  case "$(uname -m)" in
    armv6l|armv7l|i386|i686)
      echo "  Este sistema é de 32 bits: no nodejs.org escolha a linha \"Node.js 22\" (a última"
      echo "  com essa versão) ou o pacote nodejs da sua distribuição." ;;
  esac
  echo "  Instalou o Node pelo nvm/fnm e mesmo assim caiu aqui? Abra este arquivo pelo"
  echo "  Terminal: bash iniciar-mac-linux.command"
  echo "  Não pode instalar programas? Veja \"node-portable\" no README."
  echo ""
  echo "  Aperte Enter para abrir a página do Node.js no navegador..."
  read -r
  abrir_site
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
    esperar_fechar
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
