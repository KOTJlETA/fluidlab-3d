@echo off
rem Запуск через локальный HTTP-сервер (если браузер блокирует file://)
cd /d "%~dp0"
echo FluidLab 3D: http://localhost:8000
start "" http://localhost:8000
python -m http.server 8000
