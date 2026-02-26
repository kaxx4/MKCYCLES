"""
Tally Dashboard – FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api.routes import router
from app.api.order_routes import order_router
from app.api.rate_routes import rate_router
from app.api.master_override_routes import master_override_router
from app.core.config import settings
from app.core.database import create_db_and_tables
from app.core.logging import setup_logging
from app.etl.watcher import start_watcher, stop_watcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown hooks."""
    setup_logging()
    logger.info("Starting Tally Dashboard backend …")
    create_db_and_tables()
    logger.info("Database tables ready")
    start_watcher()
    yield
    stop_watcher()
    logger.info("Tally Dashboard backend shut down")


app = FastAPI(
    title="Tally Dashboard API",
    description="Local REST API for Tally ERP XML data ingestion and analytics",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS – allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(order_router)
app.include_router(rate_router)
app.include_router(master_override_router)


@app.get("/")
def root():
    return {"message": "Tally Dashboard API", "docs": "/docs"}
