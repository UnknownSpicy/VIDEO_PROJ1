from .analysis import TranscriptAnalyzer, boundaries
from .models import AnalysisRequest, ClipEdit, Transcript, UserError
from .transcripts import parse_transcript, retrieve
from .vision import SampledFrameAnalyzer


class AnalysisService:
    def __init__(self, store, router, credentials, transcript_provider=retrieve, vision=None):
        self.store, self.router, self.credentials = store, router, credentials
        self.transcript_provider = transcript_provider
        self.analyzer = TranscriptAnalyzer(router)
        self.vision = vision or SampledFrameAnalyzer(router)

    def run(self, identifier, request: AnalysisRequest):
        def progress(message):
            self.store.update(identifier, status="running", progress=message)
        try:
            key = self.credentials.get()
            if not key:
                raise UserError("Lägg till en OpenRouter API-nyckel i inställningarna innan analysen startas.")
            progress("Läser tidsatt transkript")
            if request.transcript_text.strip():
                transcript = parse_transcript(request.transcript_text, request.transcript_format)
                transcript.title = "Manuellt transkript"
            else:
                transcript = self.transcript_provider(request.youtube_url)
            self.store.update(identifier, transcript=transcript.model_dump())
            model = self.router.choose(request.model_id, refresh=True)
            self.store.update(identifier, model_id=model["id"])
            candidates, warnings = self.analyzer.candidates(transcript, request.instructions, model, key,
                                                          progress, max_clips=request.max_clips)
            warnings = transcript.warnings + warnings
            progress("Rankar transkriptbaserade klipp")
            ranked = self.analyzer.rank(candidates, request.instructions, model, key, request.max_clips)
            results = [dict(mode="transcript", model=model["id"], clips=[c.model_dump() for c in ranked],
                            method="Hela det tidsatta transkriptet; tiderna kommer från transkriptets avsnitt.")]
            # Persist useful baseline before any optional video/vision network operation.
            self.store.update(identifier, results=results, warnings=warnings)
            if request.mode in ("multimodal", "compare"):
                if not candidates:
                    warnings.append("Inga relevanta transkriptkandidater hittades; bildruteanalys hoppades över.")
                else:
                    try:
                        vision_model = self.router.choose(request.vision_model_id, vision=True, refresh=True)
                        observations, frames = self.vision.observe(request.youtube_url, candidates,
                            request.instructions, vision_model, key, progress)
                        progress("Rankar klipp med transkript och bildobservationer")
                        enhanced = self.analyzer.rank(candidates, request.instructions, model, key,
                                                      request.max_clips, visual=observations)
                        enhanced = [c.model_copy(deep=True) for c in enhanced]
                        for clip in enhanced:
                            clip.visual_context = observations.get(clip.id)
                        results.append(dict(mode="multimodal", model=model["id"], vision_model=vision_model["id"],
                            clips=[c.model_dump() for c in enhanced], frames=frames, observations=observations,
                            method="Samplade stillbilder från högst sex transkriptkandidater, två positioner per kandidat. Ingen kontinuerlig videoförståelse. Poäng och motiveringar kommer från transkriptanalysen; bildobservationer används vid omrankningen."))
                        warnings.append("Bildanalysen gäller endast samplade stillbilder. Kandidater utan bildobservation bedöms enbart från transkriptet.")
                    except UserError as error:
                        warnings.append("Bildruteanalysen kunde inte slutföras: " + str(error) + " Transkriptresultatet är sparat.")
            self.store.update(identifier, status="done", progress="Analysen är klar", results=results,
                              warnings=list(dict.fromkeys(warnings)))
        except UserError as error:
            self.store.update(identifier, status="error", error=str(error), progress="Analysen stoppades")
        except Exception:
            # Do not persist exception text: network errors can contain credential-bearing URLs.
            self.store.update(identifier, status="error", error="Ett oväntat fel uppstod. Försök igen eller använd ett annat transkript/modellval.", progress="Analysen stoppades")

    def edit(self, identifier, mode, clip_id, edit: ClipEdit):
        data = self.store.get(identifier)
        if data["status"] != "done":
            raise UserError("Vänta tills analysen är klar innan du granskar klipp.")
        transcript = Transcript.model_validate(data["transcript"])
        result = next((r for r in data["results"] if r["mode"] == mode), None)
        clip = next((c for c in result["clips"] if c["id"] == clip_id), None) if result else None
        if clip is None:
            raise UserError("Klippet finns inte.")
        if edit.start_cue_id is not None or edit.end_cue_id is not None:
            start, end, warning = boundaries(transcript.cues, edit.start_cue_id or clip["start_cue_id"],
                                             edit.end_cue_id or clip["end_cue_id"], expand=False)
            first, last = transcript.cues[start], transcript.cues[end]
            clip.update(start_cue_id=first.id, end_cue_id=last.id, start=first.start, end=last.end,
                        duration=round(last.end - first.start, 3), opening_dialogue=first.text,
                        closing_dialogue=last.text, boundary_warning=warning, adjusted=True)
            if mode == "multimodal":
                clip["visual_context"] = None
                clip["boundary_warning"] = ((warning + " ") if warning else "") + "Bildobservationer och AI-motivering gäller originalförslaget; den justerade tidsperioden har inte analyserats på nytt."
        if edit.status is not None:
            clip["status"] = edit.status
        return self.store.update(identifier, results=data["results"])
