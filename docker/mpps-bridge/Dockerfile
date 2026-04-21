FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY docker/mpps-bridge/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY docker/mpps-bridge/app.py ./app.py
COPY scripts/dicom-gateway/mpps-smoke-test.sh ./scripts/dicom-gateway/mpps-smoke-test.sh
RUN chmod +x ./scripts/dicom-gateway/mpps-smoke-test.sh

EXPOSE 11113

CMD ["python", "/app/app.py"]
