import json

import pytest

from creatoriq.analysis import TranscriptAnalyzer
from creatoriq.models import Cue, Transcript, UserError


class CapturingRouter:
    def __init__(self, hallucinate=False):
        self.seen = set()
        self.calls = 0
        self.hallucinate = hallucinate
    def complete(self,key,model,messages,max_tokens=3500):
        self.calls += 1
        payload = json.loads(messages[-1]['content'])
        cues = payload['transcript']
        self.seen.update(c['id'] for c in cues)
        if self.hallucinate:
            return json.dumps({"clips":[dict(start_cue_id='invented',end_cue_id='fabricated',topic='x',description='x',hook='x',reason='x',engagement=80,engagement_reason='x')]})
        if any(c['text'].startswith('LAST') for c in cues):
            cue = cues[-1]
            return json.dumps({"clips":[dict(start_cue_id=cue['id'],end_cue_id=cue['id'],topic='Sista delen',description='Riktig',hook='Sista poängen',reason='Relevant',engagement=90,engagement_reason='Payoff')]})
        return '{"clips":[]}'


def test_complete_long_transcript_including_last_passage_analyzed():
    cues = [Cue(id=f'c{i:05d}',start=i*5,end=i*5+5,text=f'{i} '+('ord '*60)+'.') for i in range(160)]
    cues[-1].text = 'LAST Här är sista poängen.'
    t = Transcript(cues=cues,source='fixture')
    router = CapturingRouter()
    results, warnings = TranscriptAnalyzer(router).candidates(t,'Hitta viktiga poänger.',{'context_length':16000},'test',lambda _:None)
    assert router.calls > 3
    assert router.seen == {c.id for c in cues}
    assert len(results) == 1
    assert results[0].end_cue_id == cues[-1].id
    assert results[0].end == cues[-1].end
    assert warnings == []


def test_invented_model_boundaries_never_become_clip_timestamps():
    transcript = Transcript(cues=[Cue(id='real',start=12.345,end=20.678,text='Riktigt innehåll.')],source='fixture')
    with pytest.raises(UserError,match='ogiltiga klippförslag'):
        TranscriptAnalyzer(CapturingRouter(hallucinate=True)).candidates(transcript,'Hitta poängen.',{'context_length':32000},'test',lambda _:None)


def test_final_untimed_dialogue_is_analyzed_as_context_not_a_selectable_cue():
    from creatoriq.transcripts import parse_transcript
    transcript = parse_transcript('0:00 Hela början.\n0:05 Detta är sista poängen. [END]')
    class TailRouter:
        def complete(self,key,model,messages,max_tokens=3500):
            payload = json.loads(messages[-1]['content'])
            assert payload['untimed_tail_context'] == {'start':5,'text':'Detta är sista poängen.'}
            assert len(payload['transcript']) == 1
            assert payload['transcript'][0]['text'] == 'Hela början.'
            assert 'never select it' in messages[0]['content']
            return '{"clips":[]}'
    clips, _ = TranscriptAnalyzer(TailRouter()).candidates(transcript,'Hitta poängen.',{'context_length':32000},'test',lambda _:None)
    assert clips == []


@pytest.mark.parametrize('requested',[1,3,6,12])
def test_clip_limit_changes_first_prompt_and_output_budget_and_is_enforced(requested):
    captured=[]
    cues=[Cue(id=f'c{i:05d}',start=i*8,end=i*8+8,text=f'Fullständig mening {i}.') for i in range(12)]
    class LimitRouter:
        def complete(self,key,model,messages,max_tokens=3500):
            payload=json.loads(messages[-1]['content'])
            assert payload['max_clips']==requested
            assert f'Select at most {requested} clips.' in messages[0]['content']
            captured.append(max_tokens)
            # A provider ignoring the requested maximum must still be bounded server-side.
            return json.dumps({'clips':[dict(start_cue_id=c.id,end_cue_id=c.id,topic='Insikt',description='Beskrivning',
                hook='Rubrik',reason='Motivering',engagement=80,engagement_reason='Konkret') for c in cues]})
    results,_=TranscriptAnalyzer(LimitRouter()).candidates(Transcript(cues=cues,source='fixture'),
        'Hitta tydliga klipp.',{'context_length':32000},'key',lambda _:None,max_clips=requested)
    assert len(results)==requested
    assert captured==[1200+700*requested]
