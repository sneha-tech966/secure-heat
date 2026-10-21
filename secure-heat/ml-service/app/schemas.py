from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class PredictRequest(BaseModel):
    """Values are NOT range-checked here on purpose: out-of-range readings must reach the rule engine so the
    backend gets a structured explanation. NaN/inf are rejected."""
    model_config = ConfigDict(extra="forbid")
    sensor_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    temperature: float = Field(allow_inf_nan=False)
    humidity: float = Field(allow_inf_nan=False)
    pressure: float = Field(allow_inf_nan=False)
    wind_speed: float = Field(allow_inf_nan=False)
    wind_direction: float = Field(allow_inf_nan=False)
    rainfall: float = Field(allow_inf_nan=False)
    solar_radiation: float = Field(allow_inf_nan=False)
    timestamp: Optional[datetime] = None


class RuleDetail(BaseModel):
    rule: str; category: str; severity: str; hard: bool; message: str


class PredictResponse(BaseModel):
    anomaly_score: float = Field(description="Percentile (0-1) of the reading's score among clean calibration data. NOT a probability.")
    raw_score: float
    prediction: Literal["NORMAL", "ANOMALY"]
    ml_severity: Literal["NONE", "MODERATE", "STRONG"]
    rules_triggered: list[str]
    rule_details: list[RuleDetail]
    hard_rule_violation: bool
    baseline_known: bool
    explanation: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    detail: Optional[str] = None
    dataset_version: Optional[str] = None
    trained_at: Optional[str] = None


class TrainResponse(BaseModel):
    status: str; dataset_version: str; trained_at: str; fit_rows: int; calibration_rows: int
