"""Read-only native trace predicates; not a language-server or latency mock."""


def session_id(value):
    return type(value) is int and 0 < value <= 2**53 - 1


def latest_started(records):
    return max((r['id'] for r in records if isinstance(r, dict)
                and r.get('kind') == 'start' and session_id(r.get('id'))), default=0)


def ready_java_session(records, after_id):
    """Only a newly started Java session with its own final ServiceReady qualifies.

    Readiness may precede its start record. Old-session notifications, another
    language, an error or the initialize response alone must never satisfy this.
    """
    starts = [r['id'] for r in records if isinstance(r, dict)
              and r.get('kind') == 'start' and r.get('language') == 'java'
              and session_id(r.get('id')) and r['id'] > after_id]
    if not starts:
        return None
    current = max(starts)
    if current != latest_started(records):
        return None
    statuses = [r.get('status') for r in records if isinstance(r, dict)
                and r.get('kind') == 'server_status' and r.get('language') == 'java'
                and type(r.get('id')) is int and r['id'] == current]
    return current if statuses and statuses[-1] == 'ServiceReady' else None
