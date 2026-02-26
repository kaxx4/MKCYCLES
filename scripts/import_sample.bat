@echo off
REM Import sample data via the API (Windows)
SET ROOT=%~dp0..
SET API=http://localhost:8000/api

echo Importing Master.xml...
curl -s -X POST "%API%/import" -F "file=@%ROOT%\sample_data\Master.xml"

echo.
echo Importing Transactions.xml...
curl -s -X POST "%API%/import" -F "file=@%ROOT%\sample_data\Transactions.xml"

echo.
echo Done! Check http://localhost:5173 for dashboard.
pause
