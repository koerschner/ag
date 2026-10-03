#!/usr/bin/env python3
"""Normalize DiscordChatExporter JSON into chronological, source-linked JSONL."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys


def normalize(paths):
    """Return messages once per channel/message ID, retaining attachment-only posts."""
    messages = {}
    for path in paths:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(data, dict) or not isinstance(data.get('messages'), list):
            raise ValueError(f'Not a DiscordChatExporter JSON export: {path}')
        channel = data.get('channel') or {}
        guild = data.get('guild') or {}
        channel_id = str(channel.get('id') or '')
        if not channel_id:
            raise ValueError(f'Missing channel ID: {path}')
        for message in data['messages']:
            message_id = str(message.get('id') or '')
            timestamp = message.get('timestamp')
            if not message_id or not timestamp:
                raise ValueError(f'Missing message ID/timestamp: {path}')
            instant = dt.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            if instant.tzinfo is None:
                raise ValueError(f'Timestamp has no timezone: {path}')
            author = message.get('author') or {}
            guild_id = str(guild.get('id') or '@me')
            if guild_id == '0':
                guild_id = '@me'
            category = channel.get('category')
            record = {
                'timestamp': instant.astimezone(dt.timezone.utc).isoformat(),
                'guild_id': guild_id,
                'guild': guild.get('name'),
                'channel_id': channel_id,
                'channel': channel.get('name'),
                'channel_type': channel.get('type'),
                'category': category.get('name') if isinstance(category, dict) else category,
                'message_id': message_id,
                'message_type': message.get('type'),
                'author': author.get('nickname') or author.get('name'),
                'author_id': author.get('id'),
                'author_is_bot': author.get('isBot', False),
                'content': message.get('content') or '',
                'attachments': message.get('attachments') or [],
                'embeds': message.get('embeds') or [],
                'reference': message.get('reference'),
                'edited_at': message.get('timestampEdited'),
                'url': f'https://discord.com/channels/{guild_id}/{channel_id}/{message_id}',
                'source_file': str(path),
            }
            # With overlapping snapshots, keep the version with the latest edit timestamp.
            key = (channel_id, message_id)
            previous = messages.get(key)
            edit = lambda r: dt.datetime.fromisoformat((r['edited_at'] or r['timestamp']).replace('Z', '+00:00'))
            if previous is None or edit(record) >= edit(previous):
                messages[key] = record
    return sorted(messages.values(), key=lambda r: (r['timestamp'], r['channel_id'], r['message_id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='One DCE JSON file or a directory of DCE JSON exports')
    args = parser.parse_args()
    paths = sorted(args.input.rglob('*.json')) if args.input.is_dir() else [args.input]
    if not paths:
        parser.error('No JSON exports found')
    for record in normalize(paths):
        print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
