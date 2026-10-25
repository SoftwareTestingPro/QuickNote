@echo off
title Chat Server (Port 8080)
cd /d "%~dp0"
echo ========================================================
echo  Starting Local Web Server on http://localhost:8080 ...
echo ========================================================
python -m http.server 8080
pause
