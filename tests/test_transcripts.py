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


def test_reported_transcript_structure_preserves_equal_timestamp_dialogue_and_tail():
    text = (FIXTURE.parent / 'equal_timestamps.txt').read_text()
    transcript = parse_transcript(text)
    at_89 = [c for c in transcript.cues if c.start == 89]
    assert len(at_89) == 1
    assert at_89[0].end == 97
    assert at_89[0].text.startswith('music That was the moment')
    assert transcript.untimed_tail.start == 319
    assert transcript.untimed_tail.text == 'The final line still needs an explicit end time.'
    assert transcript.cues[-1].end == 319
    assert all(c.end > c.start for c in transcript.cues)
    # Every supplied spoken word is retained, without manufacturing a last end time.
    import re
    supplied = ' '.join(line.split(' ', 1)[1] for line in text.splitlines())
    supplied = re.sub(r'\s*\[END\]"$', '', supplied)
    retained = ' '.join(c.text for c in transcript.cues) + ' ' + transcript.untimed_tail.text
    assert retained == supplied
    assert any('samma tidsstämpel' in warning for warning in transcript.warnings)
    assert any('utan känd sluttid' in warning for warning in transcript.warnings)


def test_equal_timestamp_rows_merge_before_duration_calculation():
    transcript = parse_transcript('0:00 Första delen.\n0:00 Andra delen.\n0:03 Nästa.\n0:03 Fortsättning.\n0:08 [END]')
    assert [(c.start,c.end,c.text) for c in transcript.cues] == [
        (0,3,'Första delen. Andra delen.'),(3,8,'Nästa. Fortsättning.')]
    assert transcript.untimed_tail is None


def test_inline_end_does_not_invent_end_for_speech_but_separate_timed_end_does():
    inline = parse_transcript('0:00 Början.\n0:05 Slutdialog. [END]')
    assert inline.cues[-1].end == 5
    assert inline.untimed_tail.text == 'Slutdialog.'
    explicit = parse_transcript('0:00 Början.\n0:05 Slutdialog.\n0:09 [END]')
    assert explicit.cues[-1].text == 'Slutdialog.'
    assert explicit.cues[-1].end == 9
    assert explicit.untimed_tail is None


def test_plain_text_backwards_timestamp_reports_row_even_at_last_anchor():
    with pytest.raises(UserError,match='rad 3'):
        parse_transcript('0:00 Första.\n0:10 Nästa.\n0:05 [END]')


def test_timed_subtitles_are_sorted_without_changing_explicit_ranges():
    transcript = parse_transcript('WEBVTT\n\n00:10.000 --> 00:12.000\nAndra.\n\n00:00.000 --> 00:03.000\nFörsta.\n')
    assert [(c.start,c.end,c.text) for c in transcript.cues] == [(0,3,'Första.'),(10,12,'Andra.')]
    assert any('sorterats' in warning for warning in transcript.warnings)


def test_vtt_equal_start_times_with_known_ends_remain_valid():
    transcript = parse_transcript('WEBVTT\n\n01:29.000 --> 01:37.000\nMusik.\n\n01:29.000 --> 01:37.000\nHär är dialogen.\n')
    assert [(c.start,c.end,c.text) for c in transcript.cues] == [(89,97,'Musik.'),(89,97,'Här är dialogen.')]
