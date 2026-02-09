@echo off
chcp 65001 >nul 2>&1
title NorthRadar - Setup

echo.
echo ══════════════════════════════════════════════════════
echo   NorthRadar - Setup do Ambiente
echo ══════════════════════════════════════════════════════
echo.

:: ========== Verificar Node.js ==========
echo [1/4] Verificando Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo    ❌ Node.js nao encontrado!
    echo    Baixe em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo    ✅ Node.js %NODE_VERSION% encontrado

:: ========== Verificar npm ==========
echo [2/4] Verificando npm...
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo    ❌ npm nao encontrado!
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo    ✅ npm v%NPM_VERSION% encontrado

:: ========== Instalar dependencias ==========
echo [3/4] Instalando dependencias...
echo.
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo    ❌ Erro ao instalar dependencias!
    pause
    exit /b 1
)
echo.
echo    ✅ Dependencias instaladas com sucesso

:: ========== Verificar .env ==========
echo [4/4] Verificando arquivo .env...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo    ⚠️  Arquivo .env criado a partir de .env.example
        echo    📝 Edite o .env com suas credenciais antes de executar
    ) else (
        echo    ⚠️  Arquivo .env nao encontrado!
        echo    📝 Crie um .env com as variaveis necessarias (veja README.md^)
    )
) else (
    echo    ✅ Arquivo .env encontrado
)

echo.
echo ══════════════════════════════════════════════════════
echo   ✅ Setup concluido!
echo.
echo   Para executar a aplicacao:
echo     npm start
echo ══════════════════════════════════════════════════════
echo.
pause
