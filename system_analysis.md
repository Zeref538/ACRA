# ACRA System Analysis: Architecture & Development

This document outlines a comprehensive analysis of the ACRA (Adaptive Color Re-Encoding Algorithm) system, focusing on its current architecture and development practices, and provides actionable recommendations for improvement to scale and professionalize the application.

---

## 1. Architectural Improvements

### A. Task Queues for Heavy Computation
**Current State:** Image processing is highly CPU/GPU intensive (involving YOLOv8 segmentation, Fuzzy C-Means clustering, and CIEDE2000 math). Currently, `main.py` handles these requests using a `ThreadPoolExecutor` with `max_workers=2` directly within the FastAPI web server. 
**Problem:** This severely limits concurrency. If more than two users upload images simultaneously, the API will bottleneck or time out. The Python GIL may also hinder performance even with threads.
**Recommendation:** 
- Decouple the image processing pipeline from the web server using an asynchronous task queue like **Celery** or **ARQ** backed by Redis.
- The web server should instantly return a `job_id` with a "processing" status. The frontend can then poll or use Server-Sent Events (SSE) / WebSockets to get the final result.

### B. Stateless Web Servers (Storage & Database)
**Current State:** 
- The backend stores processed images on the local disk (`static/jobs/`).
- The backend uses a local SQLite database (`jobs.db`) to track jobs.
**Problem:** This architecture is "stateful." If you deploy multiple instances of the backend (e.g., behind a load balancer) to handle more traffic, they will not share the same database or file system, causing missing images and 404 errors.
**Recommendation:**
- **Database:** Migrate from SQLite to **PostgreSQL** (since you already optionally use Supabase, you can use Supabase's Postgres database).
- **Storage:** Store images in an Object Storage service like **AWS S3** or **Supabase Storage** instead of the local file system.

### C. Machine Learning Model Serving
**Current State:** The YOLOv8 ONNX model is loaded into the memory of the FastAPI web application.
**Problem:** Loading large models in the web tier consumes a lot of RAM and can impact the web server's responsiveness.
**Recommendation:** 
- Move ML inference to a dedicated microservice. Tools like **NVIDIA Triton Inference Server** or **ONNX Runtime Server** are optimized for model serving, batching requests, and GPU utilization. Alternatively, keep it in the background worker process (Celery) rather than the API process.

---

## 2. Development & Codebase Improvements

### A. Containerization (Docker)
**Current State:** The setup process requires manual installation of Node.js, Python 3.11+, creating virtual environments, and running separate terminal commands.
**Recommendation:**
- Introduce **Docker** and **Docker Compose**.
- Create a `docker-compose.yml` that defines the `frontend`, `backend`, and any future services (like `redis` or `db`).
- This allows any new developer to start the entire system with a single `docker-compose up` command, ensuring environment consistency.

### B. Frontend State Management & API Fetching
**Current State:** The React application likely uses raw Axios calls combined with `useEffect` and `useState` for API interactions.
**Recommendation:**
- Integrate a data fetching library like **TanStack Query (React Query)** or **SWR**.
- These libraries handle caching, automatic retries, loading states, and background refetching out-of-the-box, drastically reducing boilerplate and improving the UX.

### C. Backend Validation with Pydantic
**Current State:** Form data in `/process` endpoint (`main.py`) uses raw `Form(...)` and manual boundary checking (e.g., `max(0.0, min(1.0, float(severity)))`).
**Recommendation:**
- Leverage FastAPI's core strength: **Pydantic Models**. 
- Define robust request schemas using Pydantic, which automatically handles type coercion, boundary validation (`Field(ge=0.0, le=1.0)`), and detailed error responses.

### D. Automated Testing
**Current State:** The repository lacks a visible test suite (`tests/` directory). Relying on manual testing via the UI or `TestLabPage` is risky for future refactoring.
**Recommendation:**
- **Backend:** Add `pytest`. Write unit tests for individual pipeline mathematical functions (normalization, CIEDE2000) and integration tests for FastAPI endpoints.
- **Frontend:** Add unit testing with **Vitest/Jest** and React Testing Library, and End-to-End (E2E) testing with **Playwright** or **Cypress** to simulate user uploads.

### E. Code Quality and CI/CD
**Current State:** The frontend has ESLint configured, but the backend lacks standard Python linting and formatting.
**Recommendation:**
- Introduce **Ruff** (or Black/Flake8) for backend code formatting and linting.
- Implement **MyPy** for static type checking in Python to catch type-related bugs early.
- Setup a **CI/CD Pipeline** (e.g., GitHub Actions) that automatically runs linters and tests on every commit/Pull Request.
