FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY docker/mpps-bridge/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY docker/mpps-bridge/app.py ./app.py

EXPOSE 11113

CMD ["python", "/app/app.py"]
