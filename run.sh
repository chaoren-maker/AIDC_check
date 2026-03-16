#!/usr/bin/env bash
# 在项目虚拟环境中启动服务，不占用系统 Python。
set -e
cd "$(dirname "$0")"
VENV_DIR=".venv"
if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating virtual environment at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install -q -r requirements.txt
PORT="${1:-8000}"
echo "Starting on http://127.0.0.1:$PORT (Ctrl+C to stop)"
exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
