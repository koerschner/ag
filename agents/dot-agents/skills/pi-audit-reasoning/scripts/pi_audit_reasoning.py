#!/usr/bin/env python3
"""Read-only timing audit of Pi sessions: where active agent time goes.

Port of Patrick Skinner's audit-reasoning (github.com/PSkinnerTech/audit-reasoning,
Codex-only) to Pi's session JSONL. Same accounting model: an exclusive 0-100%
distribution of active turn wall time, idle time between turns excluded,
cross-category overlaps in their own bucket, and unclassified time located
between the observed events around it. Exports metadata and timing only, never
prompts, reasoning, message bodies, commands or tool arguments.

Pi timing sources (see references/measurement.md):
  model request  = [assistant.message.timestamp (request start), entry timestamp (saved)]
  tool call      = [assistant entry timestamp, toolResult.message.timestamp]
  turn           = user message -> last event before the next user message
"""
import argparse
import collections
import csv
from datetime import datetime, timezone, timedelta
from html import escape
import itertools
import json
import os
from pathlib import Path
import re
import sys
import time

SESSIONS = Path(os.environ.get('PI_CODING_AGENT_DIR', Path.home() / '.pi' / 'agent')) / 'sessions'
MODEL, FAILED, COMPACT = 'Model response', 'Failed / aborted model request', 'Context compaction'
WAIT = 'Waiting (sleep / poll loops)'
SHELL, READ, EDIT, MCP, DELEG, OTHER = ('Shell commands', 'File reads', 'File edits', 'MCP tool calls',
                                        'Subagents & computer use', 'Other tools')
CONC, INFLIGHT, UNCL = 'Concurrent activity', 'In-flight tool call', 'Unclassified active time'
CATEGORIES = [MODEL, FAILED, COMPACT, WAIT, SHELL, READ, EDIT, MCP, DELEG, OTHER, CONC, INFLIGHT, UNCL]
TOOL_CATS = {WAIT, SHELL, READ, EDIT, MCP, DELEG, OTHER}
COLORS = ['#7764c6', '#b0506a', '#d9993c', '#e05d44', '#319581', '#4c86bd', '#87a747', '#456bb0',
          '#c97196', '#8f7e69', '#8994a1', '#579fac', '#d0d4d8']
GAP_GROUPS = ('Prompt → first model request', 'Tool result → next model request',
              'Model response → tool start', 'Failed request → retry',
              'Last activity → turn end', 'Last activity → capture cutoff', 'Other inter-event gaps')
COMPACTION_MAX_GAP = 300  # s; a longer lead-in means the compaction start is unknown (likely manual)


def tool_category(name):
    if name == 'bash': return SHELL
    if name in ('read', 'grep', 'find', 'ls'): return READ
    if name in ('edit', 'write'): return EDIT
    if name.startswith('mcp_') or name == 'mcp': return MCP
    if name in ('subagent', 'chatgpt_cua'): return DELEG
    return OTHER


SUBCOMMAND_TOOLS = {'gh', 'git', 'bun', 'herdr', 'npm', 'pnpm', 'uv', 'docker', 'npx', 'bunx', 'make', 'op-ag', 'op'}
SKIP_STEPS = {'cd', 'set', 'export', 'source', '.', 'true', 'break', 'continue', 'done', 'fi', 'esac', '}', ')'}
WRAPPERS = {'timeout', 'env', 'sudo', 'nohup', 'time', 'command', 'exec'}


def shell_program(cmd):
    """Program (and subcommand for CLIs like gh/git) of a shell command's first real step; never arguments."""
    loop = False; fallback = None
    cmd = re.sub(r'[A-Za-z_]\w*=\$\(|\$\(|`', ';', cmd or '')  # command substitutions become steps
    for step in re.split(r'&&|\|\||;|\n|\|', cmd):
        words = step.strip().split()
        while words and words[0] in ('do', 'then', 'else', 'elif', '{', '(', '!', 'for', 'while', 'until', 'if'):
            w = words.pop(0)
            if w in ('for', 'while', 'until'): loop = True
            if w == 'for': words = []
        while words and (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=\S*', words[0]) or words[0] in WRAPPERS
                         or re.fullmatch(r'-\S+|\d+[smh]?', words[0])):
            words.pop(0)
        if not words or words[0] in SKIP_STEPS: continue
        prog = os.path.basename(words[0])
        if not re.fullmatch(r'[\w.+-]+', prog): prog = 'other'
        sub = next((w for w in words[1:] if not w.startswith('-')), '')
        if prog in SUBCOMMAND_TOOLS and re.fullmatch(r'[a-z][a-z-]*', sub): prog += ' ' + sub
        if prog in ('echo', 'printf', 'umask', 'mkdir', 'test', '[', '[[', 'seq', 'date', 'other'):
            fallback = fallback or prog; continue
        return ('loop: ' if loop else '') + prog
    return ('loop: ' if loop else '') + (fallback or 'other')


def stamp(v): return datetime.fromtimestamp(v, timezone.utc).isoformat()
def epoch(v): return datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp()


def merge(spans):
    out = []
    for a, b in sorted(spans):
        if b <= a: continue
        if out and a <= out[-1][1]: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out


def seconds(spans): return sum(b - a for a, b in merge(spans))


def partition(active, items, pending=(), segments=None):
    """Exclusive wall-time buckets (Patrick's algorithm); different-category overlaps -> Concurrent."""
    events = [(a, 'active', 1) for a, _ in active] + [(b, 'active', -1) for _, b in active]
    for a, b, cat in items: events += [(a, 'item:' + cat, 1), (b, 'item:' + cat, -1)]
    for a, b in pending: events += [(a, 'pending', 1), (b, 'pending', -1)]
    counts = collections.Counter(); totals = collections.Counter(); prev = None
    for at, batch in itertools.groupby(sorted(events), key=lambda e: e[0]):
        if prev is not None and counts['active'] > 0 and at > prev:
            kinds = [k[5:] for k, n in counts.items() if k.startswith('item:') and n > 0]
            cat = CONC if len(kinds) > 1 else kinds[0] if kinds else INFLIGHT if counts['pending'] > 0 else UNCL
            totals[cat] += at - prev
            if segments is not None: segments.append((prev, at, cat))
        for _, k, d in batch: counts[k] += d
        prev = at
    return {k: totals.get(k, 0.0) for k in CATEGORIES}


def kind_of(cat):
    return 'model' if cat == MODEL else 'failed' if cat == FAILED else 'compaction' if cat == COMPACT else 'tool'


def label_gap(a, b, window, items, pending, cutoff, completed):
    lo, hi = window
    prior = [(e, kind_of(c)) for s, e, c in items if lo <= e <= a]
    nxt = [(s, kind_of(c)) for s, e, c in items if b <= s <= hi] + [(s, 'tool') for s, _ in pending if b <= s <= hi]
    p = max(prior)[1] if prior else None
    n = min(nxt)[1] if nxt else None
    if p is None and n in ('model', 'failed'): g = GAP_GROUPS[0]
    elif p == 'tool' and n in ('model', 'failed'): g = GAP_GROUPS[1]
    elif p == 'model' and n == 'tool': g = GAP_GROUPS[2]
    elif p == 'failed' and n in ('model', 'failed'): g = GAP_GROUPS[3]
    elif n is None and b == hi and not (hi == cutoff and not completed): g = GAP_GROUPS[4]
    elif n is None and b == cutoff: g = GAP_GROUPS[5]
    else: g = GAP_GROUPS[6]
    names = {None: 'Turn start', 'model': 'Model response', 'failed': 'Failed request',
             'tool': 'Tool', 'compaction': 'Compaction'}
    return g, f"{names[p]} → {names[n] if n else ('Capture cutoff' if b == cutoff and not completed else 'Turn end')}"


# ---------------------------------------------------------------- parsing

def parse(path, cutoff):
    """Parse one Pi session into turns with timed items. Never retains message content."""
    turns = []; warnings = []; settings = []; calls = {}; header = {}
    turn = None; prev_ts = None; bad = 0; model = level = None

    def close(t):
        if t and t['lastEvent'] is not None:
            t['end'] = t['lastEvent']
            turns.append(t)

    with open(path, 'rb') as f:
        for raw in f:
            try: e = json.loads(raw)
            except ValueError: bad += 1; continue
            try: at = epoch(e['timestamp'])
            except (KeyError, ValueError, TypeError): continue
            if at > cutoff: break
            typ = e.get('type')
            if typ == 'session':
                header = {'id': e.get('id'), 'cwd': e.get('cwd'), 'created': e.get('timestamp'),
                          'parentSession': e.get('parentSession')}
            elif typ == 'model_change':
                model = f"{e.get('provider')}/{e.get('modelId')}"
                settings.append({'at': stamp(at), 'model': model})
            elif typ == 'thinking_level_change':
                level = e.get('thinkingLevel'); settings.append({'at': stamp(at), 'thinkingLevel': level})
            elif typ == 'compaction':
                lead = at - prev_ts if prev_ts else None
                if turn and lead is not None and lead <= COMPACTION_MAX_GAP:
                    turn['items'].append((prev_ts, at, COMPACT)); turn['lastEvent'] = at
                    turn['compactions'] += 1
                else:
                    warnings.append(f'Compaction at {stamp(at)} has no recorded start (likely manual); excluded from time.')
            elif typ == 'message':
                m = e.get('message') or {}; role = m.get('role')
                if role == 'user':
                    close(turn)
                    start = m['timestamp'] / 1000 if isinstance(m.get('timestamp'), (int, float)) else at
                    turn = {'id': e.get('id'), 'start': start, 'end': None, 'lastEvent': start, 'items': [],
                            'pending': {}, 'status': 'running', 'models': collections.Counter(),
                            'level': level, 'usage': collections.Counter(), 'tools': collections.Counter(), 'shell': collections.Counter(), 'shellN': collections.Counter(),
                            'batches': 0, 'mixedBatches': 0, 'compactions': 0, 'requests': 0, 'failures': 0}
                elif role == 'assistant' and turn:
                    s = m['timestamp'] / 1000 if isinstance(m.get('timestamp'), (int, float)) else at
                    s = max(s, turn['start'])
                    stop = m.get('stopReason')
                    cat = FAILED if stop in ('error', 'aborted') else MODEL
                    turn['items'].append((s, at, cat)); turn['lastEvent'] = at
                    turn['requests'] += 1; turn['failures'] += cat == FAILED
                    mk = f"{m.get('provider')}/{m.get('model')}"
                    turn['models'][mk] += at - s
                    turn['level'] = m.get('providerThinkingLevel') or turn['level']
                    u = m.get('usage') or {}
                    for k in ('output', 'reasoning', 'input', 'cacheRead', 'cacheWrite'):
                        turn['usage'][k] += u.get(k) or 0
                    tcs = [c for c in m.get('content') or [] if isinstance(c, dict) and c.get('type') == 'toolCall']
                    if tcs:
                        turn['batches'] += 1
                        if len({tool_category(c.get('name', '')) for c in tcs}) > 1: turn['mixedBatches'] += 1
                    for c in tcs:
                        args = c.get('arguments') if isinstance(c.get('arguments'), dict) else {}
                        prog = shell_program(args.get('command')) if c.get('name') == 'bash' else None
                        turn['pending'][c.get('id')] = (at, c.get('name', ''), prog)
                    turn['status'] = {'stop': 'completed', 'length': 'completed', 'aborted': 'interrupted',
                                      'error': 'error'}.get(stop, 'running')
                elif role == 'toolResult' and turn:
                    call = turn['pending'].pop(m.get('toolCallId'), None)
                    end = m['timestamp'] / 1000 if isinstance(m.get('timestamp'), (int, float)) else at
                    if call and end >= call[0]:
                        cat = WAIT if call[2] and (call[2] == 'sleep' or call[2].startswith('loop:')) else tool_category(call[1])
                        turn['items'].append((call[0], end, cat))
                        turn['tools'][call[1]] += 1; turn['lastEvent'] = max(turn['lastEvent'], end)
                        if call[2]: turn['shell'][call[2]] += end - call[0]; turn['shellN'][call[2]] += 1
            prev_ts = at
    close(turn)
    if bad: warnings.append(f'Ignored {bad} unparseable line(s).')
    for i, t in enumerate(turns):
        last = i == len(turns) - 1
        t['pendingIntervals'] = []
        if t['pending']:
            if last and t['status'] == 'running':
                t['pendingIntervals'] = [[v[0], cutoff] for v in t['pending'].values()]
                t['end'] = cutoff
            else:
                warnings.append(f"Turn {t['id']}: {len(t['pending'])} tool call(s) never returned a result.")
        if t['status'] == 'running' and not last:
            t['status'] = 'interrupted'  # ended mid-tool-loop, followed by a new prompt
        if t['status'] == 'running' and last:
            t['end'] = cutoff
    return {'header': header, 'turns': turns, 'settings': settings, 'warnings': warnings}


def audit_turns(chosen, cutoff):
    totals = collections.Counter(); groups = collections.Counter(); transitions = collections.Counter()
    intervals = []; active = 0.0
    for t in chosen:
        window = (t['start'], t['end'])
        if window[1] <= window[0]: continue
        items = [(max(a, window[0]), min(b, window[1]), c) for a, b, c in t['items'] if b > window[0] and a < window[1]]
        segs = []
        for k, v in partition([window], items, t['pendingIntervals'], segs).items(): totals[k] += v
        active += window[1] - window[0]
        for a, b, cat in segs:
            if cat != UNCL: continue
            g, tr = label_gap(a, b, window, items, t['pendingIntervals'], cutoff, t['status'] != 'running')
            groups[g] += b - a; transitions[tr] += b - a
            intervals.append({'turn': t['id'], 'start': stamp(a), 'end': stamp(b), 'seconds': b - a,
                              'group': g, 'transition': tr})
    assert abs(sum(totals.values()) - active) < .01, 'Accounting failed'
    assert abs(sum(groups.values()) - totals[UNCL]) < .01, 'Gap accounting failed'
    return active, totals, groups, transitions, intervals


def inclusive(chosen):
    out = {}
    for cat in CATEGORIES[:10]:
        out[cat] = sum(seconds([[a, b] for a, b, c in t['items'] if c == cat]) for t in chosen)
    return out


def rows(values, denom, key):
    tot = sum(values.values())
    return [{key: k, 'seconds': v, 'percentOfUnclassified': 100 * v / tot if tot else 0,
             'percentOfActiveTime': 100 * v / denom if denom else 0} for k, v in values.items()]


def build(chosen, cutoff, meta):
    active, totals, groups, transitions, intervals = audit_turns(chosen, cutoff)
    if active <= 0: raise ValueError('Selected scope has no positive measured duration.')
    tools = collections.Counter(); usage = collections.Counter(); c = collections.Counter()
    shell = collections.Counter(); shell_n = collections.Counter()
    for t in chosen:
        tools.update(t['tools']); usage.update(t['usage']); shell.update(t['shell']); shell_n.update(t['shellN'])
        for k in ('requests', 'failures', 'batches', 'mixedBatches', 'compactions'): c[k] += t[k]
    span = max(t['end'] for t in chosen) - min(t['start'] for t in chosen)
    return {'schemaVersion': 1, **meta, 'cutoff': stamp(cutoff),
            'start': stamp(min(t['start'] for t in chosen)), 'end': stamp(max(t['end'] for t in chosen)),
            'provisional': any(t['status'] == 'running' for t in chosen),
            'activeSeconds': active, 'elapsedSpanSeconds': span,
            'turnCount': len(chosen), 'turnStatus': dict(collections.Counter(t['status'] for t in chosen)),
            'breakdown': [{'category': k, 'seconds': totals[k], 'percent': 100 * totals[k] / active} for k in CATEGORIES],
            'gapGroups': rows({k: groups[k] for k in GAP_GROUPS if k in groups}, active, 'group'),
            'gapTransitions': rows(dict(sorted(transitions.items())), active, 'transition'),
            'gapIntervals': intervals, 'inclusiveCategorySeconds': inclusive(chosen),
            'toolCallCounts': dict(tools.most_common()), 'counts': dict(c),
            'shellByProgram': [{'program': k, 'seconds': v, 'calls': shell_n[k]} for k, v in shell.most_common(30)],
            'tokens': dict(usage)}


# ---------------------------------------------------------------- fleet

def fleet(since, cutoff, root):
    by_model = collections.defaultdict(lambda: collections.Counter()); per_session = []
    all_turns = []; warnings = collections.Counter(); files = 0
    for path in root.glob('*/*.jsonl'):
        if path.stat().st_mtime < since: continue
        files += 1
        try: p = parse(path, cutoff)
        except (OSError, KeyError) as err: warnings[f'Unreadable session: {err}'] += 1; continue
        turns = [t for t in p['turns'] if t['start'] >= since and t['status'] != 'running' and t['end'] > t['start']]
        if not turns: continue
        for w in p['warnings']: warnings[re.sub(r'at \S+|Turn \S+:', '', w).strip()] += 1
        all_turns += turns
        a, tot, *_ = audit_turns(turns, cutoff)
        per_session.append({'session': str(path), 'cwd': p['header'].get('cwd'), 'turns': len(turns),
                            'activeSeconds': a, 'model': max(sum((t['models'] for t in turns), collections.Counter()).items(),
                                                              key=lambda x: x[1], default=('?', 0))[0],
                            'percent': {k: 100 * v / a for k, v in tot.items() if v}})
        for t in turns:
            key = (max(t['models'].items(), key=lambda x: x[1])[0] if t['models'] else 'no model call',
                   t['level'] or '-')
            ta, tt, *_ = audit_turns([t], cutoff)
            by_model[key].update(tt); by_model[key]['_active'] += ta; by_model[key]['_turns'] += 1
            by_model[key]['_output'] += t['usage']['output']; by_model[key]['_requests'] += t['requests']
    if not all_turns: raise ValueError('No completed turns in that window.')
    result = build(all_turns, cutoff, {'scope': 'fleet', 'source': {'root': str(root), 'sessionFiles': files,
                                                                    'sessionsWithTurns': len(per_session)}})
    result['warnings'] = [f'{w} ({n}×)' for w, n in warnings.most_common(12)]
    result['byModel'] = sorted(({'model': m, 'thinkingLevel': lv, 'turns': v['_turns'], 'requests': v['_requests'],
                                 'activeSeconds': v['_active'], 'outputTokens': v['_output'],
                                 'medianish': None,
                                 'percent': {k: 100 * v[k] / v['_active'] for k in CATEGORIES if v[k]}}
                                for (m, lv), v in by_model.items()), key=lambda r: -r['activeSeconds'])
    for r in result['byModel']: r.pop('medianish')
    result['topSessions'] = sorted(per_session, key=lambda r: -r['activeSeconds'])[:15]
    return result


# ---------------------------------------------------------------- reports

def svg_bars(breakdown, title, subtitle):
    h = 110 + 34 * len(breakdown)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="{h}" viewBox="0 0 1000 {h}">',
         '<rect width="100%" height="100%" fill="#fafbf8"/><style>text{font-family:-apple-system,Arial,sans-serif;fill:#24332e}</style>',
         f'<text x="24" y="36" font-size="23" font-weight="bold">{escape(title)}</text>',
         f'<text x="24" y="62" font-size="14">{escape(subtitle)}</text>']
    for i, (row, color) in enumerate(zip(breakdown, COLORS)):
        y = 86 + i * 34; w = row['percent'] * 4.9
        s += [f'<text x="310" y="{y+17}" text-anchor="end" font-size="14">{escape(row["category"])}</text>',
              f'<rect x="326" y="{y}" width="490" height="24" rx="3" fill="#e9ece7"/>',
              f'<rect x="326" y="{y}" width="{w:.2f}" height="24" rx="3" fill="{color}"/>',
              f'<text x="828" y="{y+17}" font-size="14">{row["percent"]:.1f}%  ({row["seconds"]/60:.1f} min)</text>']
    return '\n'.join(s + ['</svg>'])


LIMITATIONS = [
    'This is a time distribution, not an overthinking score. A large model share alone does not show wasted work or predict a benefit from a lower thinking level.',
    'Model response = request start → response saved. It covers queueing, prompt processing, thinking and output together; Pi does not record time to first token, so these cannot be split.',
    'In parallel tool mode Pi stamps every result in a batch at the batch finish time, so each tool in a multi-tool batch spans the whole batch. Batches mixing categories appear as Concurrent activity; same-category overlaps count once.',
    'Waiting = bash calls whose first real command is sleep or a for/while/until loop (typically CI polling). A loop that does real work is still counted here.',
    'Tool start is when the assistant message was saved; preflight/approval hooks are inside tool time.',
    'Unclassified time is active turn time with no timed model request or tool call. Gap labels locate it between observed events; they do not prove a cause (extension hooks, retry backoff and client overhead all look alike).',
    'Idle time between turns is excluded. A turn is a user prompt through its last recorded event; steering messages start a new turn.',
    'Compaction start is not recorded; it is inferred from the previous entry and dropped when that is >5 minutes earlier.',
    'Completed turns are not completed tasks. Pi session schemas are internal and may change.',
]


def write_report(r, out):
    out.mkdir(parents=True, exist_ok=False)
    fleet_mode = r['scope'] == 'fleet'
    status = 'PROVISIONAL (includes unfinished work)' if r['provisional'] else 'Completed-turn evidence'
    sub = f"{status} · {r['activeSeconds']/3600:.2f} active hours · {r['turnCount']} turns · idle excluded"
    svg = svg_bars(r['breakdown'], 'Pi agent time: where it goes', sub)
    (out / 'breakdown.svg').write_text(svg)
    (out / 'audit.json').write_text(json.dumps(r, indent=2) + '\n')
    with (out / 'breakdown.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, ['category', 'seconds', 'percent']); w.writeheader(); w.writerows(r['breakdown'])
    with (out / 'gap-intervals.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, ['turn', 'start', 'end', 'seconds', 'group', 'transition']); w.writeheader()
        w.writerows(r['gapIntervals'])
    c = r['counts']; tok = r['tokens']
    md = [f"# Pi reasoning and execution audit\n\n**{status}**\n",
          f"Scope: `{r['scope']}`. Window {r['start']} → {r['end']} (cutoff {r['cutoff']}).\n",
          f"Source: `{json.dumps(r['source'])}`\n",
          f"Active time **{r['activeSeconds']/60:.1f} min** across {r['turnCount']} turns {r['turnStatus']}. "
          f"{c.get('requests',0)} model requests ({c.get('failures',0)} failed/aborted), {c.get('batches',0)} tool batches "
          f"({c.get('mixedBatches',0)} mixing categories), {c.get('compactions',0)} compactions.\n",
          '![Time breakdown](breakdown.svg)\n', '| Activity | Minutes | Share of active time |', '|---|---:|---:|']
    md += [f"| {x['category']} | {x['seconds']/60:.2f} | {x['percent']:.2f}% |" for x in r['breakdown']]
    md += ['\n## Inclusive durations (overlap; do not sum)\n']
    md += [f'- {k}: {v/60:.2f} min' for k, v in r['inclusiveCategorySeconds'].items() if v]
    md += ['\n## Where the unclassified time occurred\n', '| Observed gap | Minutes | Share of unclassified | Share of active |', '|---|---:|---:|---:|']
    md += [f"| {x['group']} | {x['seconds']/60:.2f} | {x['percentOfUnclassified']:.1f}% | {x['percentOfActiveTime']:.2f}% |" for x in r['gapGroups']]
    md += ['\n## Shell time by program (inclusive; parallel batches overlap)\n', '| Program | Minutes | Calls | Avg s |', '|---|---:|---:|---:|']
    md += [f"| `{x['program']}` | {x['seconds']/60:.1f} | {x['calls']} | {x['seconds']/x['calls']:.1f} |" for x in r['shellByProgram'][:20]]
    md += ['\n## Tool calls by count\n'] + [f'- {k}: {v}' for k, v in list(r['toolCallCounts'].items())[:25]]
    md += [f"\nTokens: output {tok.get('output',0):,}, reported reasoning {tok.get('reasoning',0):,}, input {tok.get('input',0):,}, "
           f"cache read {tok.get('cacheRead',0):,}, cache write {tok.get('cacheWrite',0):,}.\n"]
    if fleet_mode:
        md += ['## By model and thinking level\n', '| Model | Thinking | Turns | Active h | Model % | Waiting % | Other tools % | Unclassified % | s / turn |', '|---|---|---:|---:|---:|---:|---:|---:|---:|']
        for m in r['byModel'][:20]:
            p = m['percent']
            md.append(f"| {m['model']} | {m['thinkingLevel']} | {m['turns']} | {m['activeSeconds']/3600:.2f} | "
                      f"{p.get(MODEL,0):.1f} | {p.get(WAIT,0):.1f} | {sum(v for k, v in p.items() if (k in TOOL_CATS or k == CONC) and k != WAIT):.1f} | "
                      f"{p.get(UNCL,0):.1f} | {m['activeSeconds']/m['turns']:.0f} |")
        md += ['\n## Longest sessions\n', '| Active min | Turns | Model | Session |', '|---:|---:|---|---|']
        md += [f"| {s['activeSeconds']/60:.0f} | {s['turns']} | {s['model']} | `{s['session']}` |" for s in r['topSessions']]
    md += ['\n## Interpretation\n'] + ['- ' + x for x in LIMITATIONS]
    if r.get('warnings'): md += ['\n## Coverage warnings\n'] + ['- ' + w for w in r['warnings']]
    md += ['\nNo prompts, reasoning, message bodies, commands or tool arguments are included.\n']
    text = '\n'.join(md)
    (out / 'report.md').write_text(text)
    body = text.replace('![Time breakdown](breakdown.svg)', svg)
    (out / 'report.html').write_text(md_to_html(body))


def md_to_html(text):
    """Tiny renderer for this report's own Markdown (headings, tables, lists, inline SVG)."""
    html, table = [], False
    for line in text.split('\n'):
        if line.startswith('<') or line.startswith('</'): html.append(line); continue
        if line.startswith('|'):
            cells = [c.strip() for c in line.strip('|').split('|')]
            if set(line) <= set('|-: '): continue
            if not table: html.append('<table>'); table = True; tag = 'th'
            else: tag = 'td'
            html.append('<tr>' + ''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells) + '</tr>'); continue
        if table: html.append('</table>'); table = False
        if line.startswith('#'):
            n = len(line) - len(line.lstrip('#')); html.append(f'<h{n}>{inline(line[n:].strip())}</h{n}>')
        elif line.startswith('- '): html.append(f'<li>{inline(line[2:])}</li>')
        elif line.strip(): html.append(f'<p>{inline(line)}</p>')
    if table: html.append('</table>')
    css = ('body{font:15px -apple-system,Arial,sans-serif;max-width:1040px;margin:24px auto;padding:0 16px;color:#24332e}'
           'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #dde;padding:4px 8px;text-align:right}'
           'td:first-child,th:first-child{text-align:left}code{font-size:12px;word-break:break-all}svg{max-width:100%;height:auto}')
    return f'<!doctype html><meta charset="utf-8"><title>Pi audit</title><style>{css}</style>' + '\n'.join(html)


def inline(s):
    s = escape(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    return re.sub(r'`(.+?)`', r'<code>\1</code>', s)


# ---------------------------------------------------------------- CLI

def resolve_session(arg):
    if arg:
        p = Path(arg).expanduser()
        if p.exists(): return p
        hits = [x for x in SESSIONS.glob('*/*.jsonl') if arg in x.name]
        if len(hits) == 1: return hits[0]
        raise ValueError(f'Session "{arg}" matched {len(hits)} files; pass a full path.')
    env = os.environ.get('PI_SESSION_FILE')
    if env and Path(env).exists(): return Path(env)
    raise ValueError('No current session (PI_SESSION_FILE unset). Pass --session; the newest file is never guessed.')


def parse_since(v):
    m = re.fullmatch(r'(\d+)([hdw])', v)
    if m: return time.time() - int(m[1]) * {'h': 3600, 'd': 86400, 'w': 604800}[m[2]]
    return epoch(v if 'T' in v else v + 'T00:00:00+00:00')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--session', help='Session .jsonl path or unique id fragment (default: $PI_SESSION_FILE)')
    ap.add_argument('--scope', choices=['last-completed', 'current', 'session', 'fleet'], default='last-completed')
    ap.add_argument('--since', default='7d', help='Fleet window: 24h, 7d, 2w or an ISO date (default 7d)')
    ap.add_argument('--turn', help='Audit one turn by its user-message entry id')
    ap.add_argument('--list-turns', action='store_true')
    ap.add_argument('--cutoff', help='Timezone-aware ISO capture time (default now)')
    ap.add_argument('--output', type=Path)
    a = ap.parse_args()
    try:
        cutoff = epoch(a.cutoff) if a.cutoff else time.time()
        if a.scope == 'fleet':
            r = fleet(parse_since(a.since), cutoff, SESSIONS)
        else:
            path = resolve_session(a.session); p = parse(path, cutoff); turns = p['turns']
            if a.list_turns:
                print(json.dumps([{'id': t['id'], 'start': stamp(t['start']), 'end': stamp(t['end']),
                                   'status': t['status'], 'requests': t['requests']} for t in turns], indent=2)); return
            if a.turn: chosen = [t for t in turns if t['id'] == a.turn]
            elif a.scope == 'last-completed': chosen = [t for t in turns if t['status'] != 'running'][-1:]
            elif a.scope == 'current': chosen = turns[-1:]
            else: chosen = turns
            if not chosen: raise ValueError('No matching turn in this session.')
            r = build(chosen, cutoff, {'scope': 'explicit-turn' if a.turn else a.scope,
                                       'source': {'session': str(path), **p['header']}, 'modelSettings': p['settings']})
            r['warnings'] = p['warnings']
            r['turns'] = [{'id': t['id'], 'start': stamp(t['start']), 'end': stamp(t['end']), 'status': t['status']} for t in chosen]
        out = a.output or Path.home() / '.local/share/pi-audit-reasoning' / (
            f"{r['scope']}-" + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        write_report(r, out)
        print(json.dumps({'report': str(out / 'report.md'), 'html': str(out / 'report.html'), 'scope': r['scope'],
                          'provisional': r['provisional'], 'activeMinutes': round(r['activeSeconds'] / 60, 1),
                          'turns': r['turnCount'],
                          'breakdown': {x['category']: round(x['percent'], 1) for x in r['breakdown'] if x['seconds']},
                          'gapGroups': {x['group']: round(x['percentOfActiveTime'], 2) for x in r['gapGroups']},
                          'warnings': r.get('warnings', [])[:5]}, indent=2))
    except (ValueError, OSError) as err:
        ap.exit(2, f'Audit unavailable: {err}\n')


if __name__ == '__main__':
    main()
