cd /d C:\Users\Redmyre\Desktop\HVAC_Auto
:loop
python door_daemon.py
timeout /t 5 /nobreak >nul
goto loop
