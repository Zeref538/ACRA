FROM python:3.12-slim

# System libs needed by Pillow, OpenCV, ONNX Runtime, and NumPy
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps before copying source (layer cache)
COPY code/requirements.txt code/requirements.txt
RUN pip install --no-cache-dir -r code/requirements.txt

# Copy application source
COPY code/ code/

# Download the ONNX segmentation model from GitHub at build time
# This keeps the HF Space repo lightweight (no git-lfs required)
RUN wget -q "https://github.com/Zeref538/ACRA/raw/main/code/acra_medium_v7_best.onnx" \
    -O code/acra_medium_v7_best.onnx

# Runtime directories for job images and SQLite (ephemeral on free tier)
RUN mkdir -p code/static/jobs code/static/test-runs

# Hugging Face Spaces requires port 7860
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "cd code && uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
