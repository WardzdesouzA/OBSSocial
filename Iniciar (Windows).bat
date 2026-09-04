@echo off
title OBS Social
cd /d "%~dp0"
rem Deixa a janela entender acentos e outros alfabetos (UTF-8).
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERRO: O Node.js nao esta instalado neste computador.
  echo  Baixe e instale em: https://nodejs.org  ^(botao verde "LTS"^)
  echo  Depois abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

rem Os componentes ja vem juntos no download; o npm so roda se a pasta sumir.
if not exist "node_modules\ws" (
  echo Instalando componentes, aguarde...
  call npm install
  if not exist "node_modules\ws" (
    echo Tentando de novo...
    call npm install
  )
  if not exist "node_modules\ws" (
    echo.
    echo  ERRO: Nao consegui baixar os componentes.
    echo  Isso costuma ser causado por antivirus ou proxy interceptando a internet.
    echo  Solucao mais simples: baixe o projeto de novo pelo site do GitHub
    echo  ^(o ZIP ja vem com os componentes inclusos^).
    echo.
    pause
    exit /b 1
  )
)

rem Se o Node suportar, confia tambem nos certificados do Windows.
rem Resolve antivirus/firewall com "inspecao HTTPS" sem desligar a seguranca.
node --use-system-ca -e "process.exit(0)" >nul 2>nul
if not errorlevel 1 set "NODE_OPTIONS=--use-system-ca"

rem Marca que o programa foi aberto por este script: reinicios e atualizacoes
rem reusam ESTA janela (codigo 10 = reabrir), sem acumular janelas.
set "OBS_SOCIAL_BAT=1"
:loop
node server.js
if "%errorlevel%"=="10" goto loop
if "%errorlevel%"=="0" exit
pause
