#!/usr/bin/env python3
"""Run: python3 test_pi_audit_reasoning.py"""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import pi_audit_reasoning as P

T0 = 1_790_000_000.0


def iso(t): return datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z')


def session(entries):
    f = tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False)
    f.write(json.dumps({'type': 'session', 'version': 3, 'id': 's1', 'timestamp': iso(T0), 'cwd': '/x'}) + '\n')
    for e in entries: f.write(json.dumps(e) + '\n')
    f.close(); return Path(f.name)


def user(t, i='u'): return {'type': 'message', 'id': i, 'timestamp': iso(t), 'message': {'role': 'user', 'timestamp': t * 1000}}


def asst(start, end, stop='toolUse', calls=()):
    return {'type': 'message', 'id': f'a{start}', 'timestamp': iso(end), 'message': {
        'role': 'assistant', 'timestamp': start * 1000, 'stopReason': stop, 'provider': 'p', 'model': 'm',
        'usage': {'output': 10}, 'content': [{'type': 'toolCall', 'id': cid, 'name': n, 'arguments': {'command': c}}
                                             for cid, n, c in calls]}}


def result(t, cid, name='bash'):
    return {'type': 'message', 'id': f'r{cid}', 'timestamp': iso(t),
            'message': {'role': 'toolResult', 'toolCallId': cid, 'toolName': name, 'timestamp': t * 1000}}


class Audit(unittest.TestCase):
    def run_audit(self, entries, cutoff=T0 + 10_000):
        p = P.parse(session(entries), cutoff)
        return p, P.build(p['turns'], cutoff, {'scope': 'session', 'source': {}})

    def test_exclusive_sums_and_categories(self):
        p, r = self.run_audit([
            user(T0 + 1), asst(T0 + 2, T0 + 5, calls=[('c1', 'bash', 'cd x && gh run view 1')]),
            result(T0 + 9, 'c1'), asst(T0 + 9, T0 + 11, calls=[('c2', 'bash', 'sleep 60; gh run view')]),
            result(T0 + 71, 'c2'), asst(T0 + 71, T0 + 73, stop='stop'),
            user(T0 + 500, 'u2'), asst(T0 + 501, T0 + 502, stop='error'), asst(T0 + 504, T0 + 505, stop='stop')])
        b = {x['category']: x['seconds'] for x in r['breakdown']}
        self.assertAlmostEqual(r['activeSeconds'], 72 + 5)          # idle between turns excluded
        self.assertAlmostEqual(sum(b.values()), r['activeSeconds'])
        self.assertAlmostEqual(b[P.MODEL], 3 + 2 + 2 + 1)
        self.assertAlmostEqual(b[P.FAILED], 1)
        self.assertAlmostEqual(b[P.SHELL], 4)
        self.assertAlmostEqual(b[P.WAIT], 60)
        gaps = {g['group']: g['seconds'] for g in r['gapGroups']}
        self.assertAlmostEqual(gaps['Prompt → first model request'], 2)
        self.assertAlmostEqual(gaps['Failed request → retry'], 2)
        self.assertEqual(r['turnStatus'], {'completed': 2})
        self.assertEqual({x['program'] for x in r['shellByProgram']}, {'gh run', 'sleep'})

    def test_mixed_parallel_batch_is_concurrent(self):
        _, r = self.run_audit([user(T0), asst(T0, T0 + 1, calls=[('a', 'bash', 'ls'), ('b', 'read', '')]),
                               result(T0 + 5, 'a'), result(T0 + 5, 'b', 'read'), asst(T0 + 5, T0 + 6, 'stop')])
        b = {x['category']: x['seconds'] for x in r['breakdown']}
        self.assertAlmostEqual(b[P.CONC], 4)

    def test_running_turn_has_inflight_call(self):
        p, r = self.run_audit([user(T0), asst(T0, T0 + 1, calls=[('a', 'bash', 'bun test')])], cutoff=T0 + 31)
        self.assertEqual(p['turns'][-1]['status'], 'running')
        self.assertTrue(r['provisional'])
        self.assertAlmostEqual({x['category']: x['seconds'] for x in r['breakdown']}[P.INFLIGHT], 30)

    def test_shell_program_never_leaks_arguments(self):
        cases = {'FOO=secret timeout 90 gh pr checks 5': 'gh pr', 'echo hi; bun run check': 'bun run',
                 'for i in $(seq 9); do out=$(gh pr checks 1); sleep 5; done': 'loop: gh pr',
                 'curl -H "Authorization: Bearer abc" x': 'curl', 'git commit -m "msg"': 'git commit'}
        for cmd, want in cases.items(): self.assertEqual(P.shell_program(cmd), want)


if __name__ == '__main__':
    unittest.main()
