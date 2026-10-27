"""Conservative repair of citation metadata; never edits layout or source text."""
import copy


def normalize_source_anchors(response, script):
    result = copy.deepcopy(response)
    shots = {shot['key']: shot for shot in script['shots']}
    index = {shot['key']: i for i, shot in enumerate(script['shots'])}
    changes = []
    groups = result.get('dialogueGroups', [])
    if not isinstance(groups, list):
        return result, changes
    for gi, group in enumerate(groups):
        if not isinstance(group, dict) or not isinstance(group.get('sourceAnchors', []), list):
            continue
        start = index.get(group.get('startShotCode'), -1)
        end = index.get(group.get('endShotCode'), -1)
        for ai, anchor in enumerate(group.get('sourceAnchors', [])):
            if not isinstance(anchor, dict):
                continue
            extras = set(anchor) - {'shotCode', 'quote'}
            if not extras or not extras <= {'key', 'shotKey', 'field', 'sourceField'}:
                continue
            key, quote = anchor.get('shotCode'), anchor.get('quote')
            shot = shots.get(key) if isinstance(key, str) else None
            if not shot or not isinstance(quote, str) or not quote or not 0 <= start <= index[key] <= end:
                continue
            # Aliases must agree with the canonical identity and exact original field.
            if any(anchor[name] != key for name in ('key', 'shotKey') if name in anchor):
                continue
            fields = [anchor[name] for name in ('field', 'sourceField') if name in anchor]
            if fields and (any(not isinstance(field, str) for field in fields)
                           or len(set(fields)) != 1 or fields[0] not in ('description', 'dialogue')
                           or quote not in str(shot.get(fields[0], ''))):
                continue
            if not any(quote in str(shot.get(name, '')) for name in ('description', 'dialogue')):
                continue
            for name in sorted(extras):
                del anchor[name]
                changes.append({'path': f'/dialogueGroups/{gi}/sourceAnchors/{ai}/{name}',
                                'operation': 'remove_redundant_citation_alias'})
    return result, changes
