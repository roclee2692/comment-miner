#!/bin/bash
# 如果有持久化磁盘挂载，将 data/ 和 reports/ 指向持久化目录
if [ -d "/data_persist" ]; then
    mkdir -p /data_persist/data /data_persist/reports
    ln -sfn /data_persist/data /app/data
    ln -sfn /data_persist/reports /app/reports
fi

exec uvicorn server:app --host 0.0.0.0 --port "${PORT:-8000}"
