cd /d C:\Users\Redmyre\Desktop\HVAC_Auto
:loop
python HVAC_daemon_Auto.py
timeout /t 5 /nobreak >nul
goto loop