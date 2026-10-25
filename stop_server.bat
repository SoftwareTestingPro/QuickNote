@echo off
title Stop Chat Server
echo ========================================================
echo  Stopping Python Web Server on port 8080 ...
echo ========================================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do (
    echo Terminating process with PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Server stopped successfully.
pause
