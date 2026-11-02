@echo off
rem 《福鼎城镇演化》一键启动：起本地服务器（端口 8943）并打开浏览器
chcp 65001 >nul
cd /d "%~dp0"
start "" http://127.0.0.1:8943
node server.js 8943
