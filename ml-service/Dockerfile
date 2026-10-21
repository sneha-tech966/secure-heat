FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# The dataset (SYNTHETIC) and the model are reproducible build steps; the API only LOADS the model at startup, never trains per request.
# tune_model.py runs a validation-only grid search (several minutes). Remove it to use the default configuration.
RUN python scripts/generate_dataset.py && python scripts/tune_model.py && python scripts/train_model.py && python scripts/evaluate_model.py
RUN useradd -m app && chown -R app /srv
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD python -c "import json,sys,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health')); sys.exit(0 if d.get('model_loaded') else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
