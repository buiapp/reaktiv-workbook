import copy
import json
from reaktiv_workbook.output_transport import pack_outputs


def test_explicit_content_references_are_lossless_stateless_and_do_not_mutate_snapshots():
    raw = {'cells':[{'id':'A1','value':[1,2], 'richOutput':{'mimeType':'application/test','dataBase64':'x'*100000}}],
           'actions':[{'output':{'richOutput':{'mimeType':'text/html','dataBase64':'abc'}}}]}
    before = copy.deepcopy(raw)
    first = pack_outputs(raw)
    key = first['cells'][0]['richOutput']['cacheKey']
    compact = pack_outputs(raw,[key])
    assert compact['cells'][0]['richOutput'] == {'cacheKey':key}
    assert compact['actions'][0]['output']['richOutput']['dataBase64'] == 'abc'
    assert len(json.dumps(compact)) < len(json.dumps(first))/100
    assert raw == before
    # A new client, skipped frame, changed MIME, or changed data gets full content.
    assert pack_outputs(raw,[]) == first
    changed = copy.deepcopy(raw);changed['cells'][0]['richOutput']['dataBase64']='y'*100000
    assert 'dataBase64' in pack_outputs(changed,[key])['cells'][0]['richOutput']
    assert pack_outputs({'snapshot':raw},[key])['snapshot']['cells'][0]['richOutput']=={'cacheKey':key}
    assert pack_outputs({'cancelled':True}) == {'cancelled':True}
