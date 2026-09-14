"""Offline checks: no Discord credentials or network requests required."""
import json
from pathlib import Path
import tempfile
import unittest
from flatten import normalize


class NormalizeTests(unittest.TestCase):
    def test_threads_attachments_duplicates_and_timezones(self):
        with tempfile.TemporaryDirectory() as folder:
            first = Path(folder) / 'first.json'
            second = Path(folder) / 'second.json'
            first.write_text(json.dumps({
                'guild': {'id': '1', 'name': 'Example'},
                'channel': {'id': '2', 'name': 'notes', 'category': 'Internal'},
                'messages': [
                    {'id': '10', 'timestamp': '2026-09-11T10:00:00-04:00', 'content': 'old'},
                    {'id': '11', 'timestamp': '2026-09-11T13:30:00+00:00', 'content': '',
                     'author': {'name': 'Fixture bot', 'isBot': True},
                     'attachments': [{'fileName': 'example.png', 'url': 'https://example.com/example.png'}]},
                ],
            }))
            second.write_text(json.dumps({
                'guild': {'id': '1'}, 'channel': {'id': '2', 'name': 'notes', 'type': 'PublicThread'},
                'messages': [{'id': '10', 'timestamp': '2026-09-11T14:00:00Z',
                              'timestampEdited': '2026-09-11T15:00:00Z', 'content': 'updated'}],
            }))
            results = normalize([second, first])
            self.assertEqual(len(results), 2)
            self.assertEqual([r['message_id'] for r in results], ['11', '10'])
            self.assertEqual(results[1]['content'], 'updated')
            self.assertEqual(results[1]['channel_type'], 'PublicThread')
            self.assertEqual(results[0]['category'], 'Internal')
            self.assertTrue(results[0]['author_is_bot'])
            self.assertEqual(results[0]['attachments'][0]['fileName'], 'example.png')
            self.assertEqual(results[1]['url'], 'https://discord.com/channels/1/2/10')

    def test_rejects_non_export(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'not-export.json'
            path.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Not a DiscordChatExporter'):
                normalize([path])

    def test_rejects_ambiguous_time(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad-time.json'
            path.write_text(json.dumps({'channel': {'id': '1'}, 'messages': [
                {'id': '2', 'timestamp': '2026-09-11T00:00:00', 'content': 'fixture'},
            ]}))
            with self.assertRaisesRegex(ValueError, 'no timezone'):
                normalize([path])


if __name__ == '__main__':
    unittest.main()
