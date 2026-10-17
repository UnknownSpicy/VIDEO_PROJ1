from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Cue(BaseModel):
    id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def valid_range(self):
        if self.end <= self.start:
            raise ValueError("Transkriptavsnittets slut måste vara efter dess start.")
        return self


class UntimedTail(BaseModel):
    start: float = Field(ge=0)
    text: str = Field(min_length=1)


class Transcript(BaseModel):
    cues: list[Cue]
    source: str
    language: str | None = None
    title: str = "YouTube-video"
    warnings: list[str] = Field(default_factory=list)
    untimed_tail: UntimedTail | None = None


class Clip(BaseModel):
    id: str
    start_cue_id: str
    end_cue_id: str
    start: float
    end: float
    duration: float
    topic: str
    description: str
    hook: str
    reason: str
    opening_dialogue: str
    closing_dialogue: str
    engagement: int = Field(ge=0, le=100)
    engagement_reason: str
    boundary_warning: str | None = None
    visual_context: str | None = None
    status: Literal["suggested", "selected", "rejected"] = "suggested"
    adjusted: bool = False


class ClipEdit(BaseModel):
    status: Literal["suggested", "selected", "rejected"] | None = None
    start_cue_id: str | None = None
    end_cue_id: str | None = None


class AnalysisRequest(BaseModel):
    youtube_url: str = ""
    instructions: str = Field(min_length=3, max_length=6000)
    transcript_text: str = Field(default="", max_length=1_500_000)
    transcript_format: Literal["auto", "srt", "vtt", "text"] = "auto"
    mode: Literal["transcript", "multimodal", "compare"] = "transcript"
    model_id: str | None = None
    vision_model_id: str | None = None
    max_clips: int = Field(default=6, ge=1, le=12)


class UserError(Exception):
    """Safe, actionable error suitable for displaying to the user."""
