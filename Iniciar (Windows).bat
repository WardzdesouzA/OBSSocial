@echo off
title OBS Social
cd /d "%~dp0"
rem Deixa a janela entender acentos e outros alfabetos (UTF-8).
chcp 65001 >nul

rem ---------------------------------------------------------------------------
rem Node.js e o motor que executa o programa — e a unica coisa que nao vem no
rem ZIP: e instalado pelo instalador oficial do nodejs.org. Este script so
rem confere se ele existe e serve (versao 18 ou mais nova) e, se nao, explica o
rem que fazer. De proposito, ele NAO baixa nem executa programas da internet:
rem esse e justamente o comportamento que faz antivirus bloquearem um programa.
rem (A unica rede que ele usa e o npm, que vem com o Node.js, para repor os
rem dois componentes se a pasta node_modules tiver sumido.)
rem Quem nao pode instalar programas pode usar uma copia portatil: a pasta
rem "node-portable" (com o node.exe dentro), ao lado deste arquivo.
rem ---------------------------------------------------------------------------
set "NODE_MIN=18"
set "NODE_PORTATIL=%~dp0node-portable"

call :node_serve
if not errorlevel 1 goto node_ok
if not exist "%NODE_PORTATIL%\node.exe" goto node_falta
set "PATH=%NODE_PORTATIL%;%PATH%"
call :node_serve
if not errorlevel 1 goto node_ok

:node_falta
set "NODE_VER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo.
if defined NODE_VER (
  echo  O Node.js deste computador e antigo demais ^(%NODE_VER%^): o OBS Social
  echo  precisa da versao %NODE_MIN% ou mais nova.
) else (
  echo  O Node.js ^(o motor que executa o programa^) nao esta instalado neste
  echo  computador. E a unica coisa que nao vem no ZIP, e instala em 1 minuto.
)
echo.
echo  Como resolver: entre em https://nodejs.org , clique no botao verde "LTS",
echo  instale como qualquer programa ^(avancar, avancar, concluir^) e abra este
echo  arquivo de novo. Nao precisa reiniciar o computador.
echo.
echo  Aperte qualquer tecla para abrir a pagina do Node.js no navegador...
pause >nul
start "" "https://nodejs.org/"
exit /b 1

:node_ok
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
exit /b 1

rem ===========================================================================
rem Sub-rotina (so roda quando chamada com "call")
rem ===========================================================================

rem --- Ha um Node.js que serve (versao %NODE_MIN% ou mais nova) no PATH? ---
rem     Sai com 0 = sim; 1 = nao achou ou e antigo demais.
:node_serve
where node >nul 2>nul || exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= %NODE_MIN% ? 0 : 1)" >nul 2>nul
exit /b %errorlevel%
