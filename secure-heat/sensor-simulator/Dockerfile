FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator.py scenarios.py ./
# uid 1000 matches the backend's `node` user so it can read the credentials file the seed wrote (mode 0600) on the shared volume
RUN useradd -m -u 1000 sim && chown -R sim /app
USER sim
EXPOSE 5055
# serve = idle until Start is pressed in the dashboard. Binding 0.0.0.0 requires SIM_CONTROL_TOKEN (enforced by the simulator).
CMD ["python", "simulator.py", "serve", "--control-host", "0.0.0.0", "--control-port", "5055", "--interval", "5"]
