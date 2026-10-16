@echo off
title OBS Social
cd /d "%~dp0"
rem Deixa a janela entender acentos e outros alfabetos (UTF-8).
chcp 65001 >nul
rem Node.js e o motor do programa - a unica coisa que nao vem no ZIP (instala
rem pelo site oficial, nodejs.org). Aqui so se confere se ele existe e serve
rem (versao 18+); se nao, :node_falta explica. De proposito NAO baixa nem roda
rem programas da internet (so o npm repoe node_modules se a pasta sumir).
set "NODE_MIN=18"
set "NODE_PORTATIL=%~dp0node-portable"
call :node_serve
if not errorlevel 1 goto node_ok
if not exist "%NODE_PORTATIL%\node.exe" goto node_falta
set "PATH=%NODE_PORTATIL%;%PATH%"
call :node_serve
if errorlevel 1 goto node_falta

:node_ok
rem Os componentes ja vem juntos no download; o npm so roda se a pasta sumir.
if not exist "node_modules\ws" call :componentes
if not exist "node_modules\ws" exit /b 1
rem Se o Node suportar, confia tambem nos certificados do Windows (antivirus
rem com "inspecao HTTPS" deixam de atrapalhar, sem desligar a seguranca).
node --use-system-ca -e "process.exit(0)" >nul 2>nul
if not errorlevel 1 set "NODE_OPTIONS=--use-system-ca"
rem Aberto por este script: reinicios e atualizacoes reusam ESTA janela
rem (codigo 10 = reabrir), sem acumular janelas.
set "OBS_SOCIAL_BAT=1"
:loop
node server.js
rem -------------------------------------------------------------------------
rem posicao proposital das 2 linhas abaixo (no byte 1432): ver a nota no fim
if "%errorlevel%"=="10" goto loop
if "%errorlevel%"=="0" exit
pause
exit /b 1

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
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 (
  echo  Este Windows e de 32 bits: no nodejs.org escolha a linha "Node.js 22",
  echo  a ultima com instalador de 32 bits ^(a 24 so tem 64 bits e ARM^).
)
echo  Nao pode instalar programas? Veja "node-portable" no README.
echo.
echo  Aperte qualquer tecla para abrir a pagina do Node.js no navegador...
pause >nul
start "" "https://nodejs.org/"
exit /b 1

rem --- Repoe os componentes (so roda se a pasta node_modules sumiu) ---
:componentes
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
)
exit /b 0

rem --- Ha um Node.js que serve (versao %NODE_MIN% ou mais nova) no PATH? ---
rem     Sai com 0 = sim; 1 = nao achou ou e antigo demais.
:node_serve
where node >nul 2>nul || exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= %NODE_MIN% ? 0 : 1)" >nul 2>nul
exit /b %errorlevel%

rem ===========================================================================
rem Nota sobre a posicao do laco (":loop") la em cima: o cmd le este arquivo
rem por posicao de byte e reabre o arquivo a cada linha. Quando o programa se
rem atualiza, a janela aberta por uma versao anterior continua parada no
rem "node server.js" dela e, ao retomar, le ESTE arquivo a partir daquela
rem posicao. Por isso as linhas "if ... goto loop" / "if ... exit" ficam
rem exatamente onde a versao 0.183 as esperava (byte 1432): a janela antiga le
rem o "exit" e fecha sozinha, em vez de executar um trecho qualquer do script
rem novo. A partir da 0.184 o proprio programa troca o .bat so depois de a
rem janela antiga fechar, e esse cuidado deixa de ser necessario.
rem ===========================================================================
