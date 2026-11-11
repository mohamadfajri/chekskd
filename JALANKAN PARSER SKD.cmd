@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

python -c "import pypdf, pymupdf" >nul 2>&1
if not errorlevel 1 goto :python
py -3 -c "import pypdf, pymupdf" >nul 2>&1
if not errorlevel 1 goto :py
set "HERMES_PY=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe"
if not exist "%HERMES_PY%" goto :missing
"%HERMES_PY%" -c "import pypdf, pymupdf" >nul 2>&1
if errorlevel 1 goto :missing
"%HERMES_PY%" -u "tools\skd\run_skd_intake.py" %*
goto :finish

:python
python -u "tools\skd\run_skd_intake.py" %*
goto :finish

:py
py -3 -u "tools\skd\run_skd_intake.py" %*
goto :finish

:missing
echo Python dengan pypdf dan pymupdf belum tersedia.
echo Pasang dependensi dengan: py -3 -m pip install -r tools\skd\requirements.txt
set "RC=1"
goto :end

:finish
set "RC=%ERRORLEVEL%"

:end
popd
if not defined SKD_NO_PAUSE pause
exit /b %RC%
