@echo off
rem Installs the Sydney timezone data for Python (only if missing). Does NOT touch doors or the running daemon.
python -c "import zoneinfo; zoneinfo.ZoneInfo('Australia/Sydney'); print('Sydney timezone data is already installed. Nothing to do.')" 2>nul && goto done
echo Installing tzdata ...
python -m pip install tzdata
python -c "import zoneinfo; zoneinfo.ZoneInfo('Australia/Sydney'); print('OK: Sydney timezone data is installed.')"
:done
pause
