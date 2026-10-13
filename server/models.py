"""Validated wire contracts; coordinates are fractions of the displayed page."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Rect(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def contained(self) -> "Rect":
        if self.x + self.w > 1.000001 or self.y + self.h > 1.000001:
            raise ValueError("Crop regions must fit inside the page.")
        return self


class GroupOptions(BaseModel):
    mode: Literal["parity", "size", "individual"] = "parity"
    excludes: str = Field(default="", max_length=10000)


class Group(BaseModel):
    id: str
    label: str
    pages: list[int]
    samples: list[int]
    width: float
    height: float
    individual: bool = False


class PagePlan(BaseModel):
    pages: list[int] = Field(min_length=1, max_length=2000)
    rects: list[Rect] = Field(default_factory=list, max_length=32)


class ExportPlan(BaseModel):
    groups: list[PagePlan] = Field(min_length=1, max_length=2000)


class AutoOptions(BaseModel):
    margin: float = Field(default=6, ge=0, le=72)
    threshold: int = Field(default=245, ge=128, le=254)
