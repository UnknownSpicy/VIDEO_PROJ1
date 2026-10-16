from pathlib import Path

import pytest

from creatoriq.analysis import Candidate, boundaries, chunks, distinct, resolve
from creatoriq.models import UserError
from creatoriq.transcripts import canonical_url, parse_transcript, seconds, youtube_id

FIXTURE = Path(__file__).parent / "fixtures" / "example.vtt"


def test_vtt_exact_timing_and_real_dialogue():
    transcript = parse_transcript(FIXTURE.read_text())
    assert len(transcript.cues) == 11
    candidate = Candidate(start_cue_id="c00001", end_cue_id="c00004", topic="Publik", description="Råd",
                          hook="Var användbar", reason="Konkret", engagement=82, engagement_reason="Tydlig poäng")
    clip = resolve(candidate, transcript)
    assert (clip.start, clip.end, clip.duration) == (8, 50, 42)
    assert clip.opening_dialogue == transcript.cues[1].text
    assert clip.closing_dialogue == transcript.cues[4].text
    assert clip.boundary_warning is None


def test_srt_comma_millisecond_and_multiline():
    text = '1\n00:01:02,125 --> 00:01:04,750\nHej <i>världen</i> &amp;\nen rad till.\n'
    cue = parse_transcript(text).cues[0]
    assert (cue.start, cue.end) == (62.125, 64.750)
    assert cue.text == "Hej världen & en rad till."


def test_plain_text_requires_anchors_and_does_not_invent_last_end():
    with pytest.raises(UserError, match="tidsstämplar"):
        parse_transcript("Untimed speech cannot be used.")
    transcript = parse_transcript("00:05 Hej.\n00:12 Nästa.\n00:19 [END]")
    assert [(c.start, c.end) for c in transcript.cues] == [(5, 12), (12, 19)]
    assert transcript.warnings


@pytest.mark.parametrize("url", ["http://youtube.com/watch?v=abcdefghijk", "https://evil.com/watch?v=abcdefghijk",
                                  "https://youtube.com.evil.com/watch?v=abcdefghijk", "file:///etc/passwd",
                                  "https://user:password@youtube.com/watch?v=abcdefghijk", "https://youtu.be/too-short"])
def test_rejects_non_youtube_and_unsafe_urls(url):
    with pytest.raises(UserError):
        youtube_id(url)


def test_youtube_url_canonicalization():
    assert canonical_url("https://youtu.be/abcdefghijk?t=10") == "https://www.youtube.com/watch?v=abcdefghijk"
    assert youtube_id("https://www.youtube.com/shorts/abcdefghijk") == "abcdefghijk"


def test_invalid_ids_and_reversed_ranges_rejected():
    cues = parse_transcript(FIXTURE.read_text()).cues
    with pytest.raises(UserError):
        boundaries(cues, "invented", "c00001")
    with pytest.raises(UserError):
        boundaries(cues, "c00004", "c00000")


def test_sentence_expansion_uses_only_actual_cues():
    t = parse_transcript('WEBVTT\n\n00:00.000 --> 00:02.000\nEn hel\n\n00:02.000 --> 00:04.000\nmening.\n\n00:04.000 --> 00:06.000\nNästa\n\n00:06.000 --> 00:08.000\nslutar här.\n')
    assert boundaries(t.cues, "c00001", "c00002") == (0, 3, None)
    assert boundaries(t.cues, "c00001", "c00002", expand=False)[2]


def test_all_long_transcript_cues_are_covered():
    from creatoriq.models import Cue
    cues = [Cue(id=f"c{i:05d}", start=i*4, end=i*4+4, text=f"Avsnitt {i} " + "ord "*40 + ".") for i in range(350)]
    batches = list(chunks(cues, 2500))
    assert len(batches) > 20
    assert {c.id for b in batches for c in b} == {c.id for c in cues}
    assert batches[-1][-1].id == cues[-1].id
    assert all(sum(len(c.id)+len(c.text)+30 for c in b) <= 2500 for b in batches)


def test_rolling_captions_normalize_duplicates():
    t = parse_transcript('WEBVTT\n\n00:00.000 --> 00:04.000\nHej där\n\n00:01.000 --> 00:05.000\nHej där\n\n00:04.000 --> 00:08.000\nHej där världen.\n')
    assert [c.text for c in t.cues] == ["Hej där", "världen."]
    assert t.warnings


def test_out_of_order_rejected():
    with pytest.raises(UserError):
        parse_transcript("00:10 Hej.\n00:05 Fel.\n00:20 [END]")
    with pytest.raises(UserError):
        seconds("00:78:12")
