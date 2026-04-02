# Chat Test Tool

Static split-pane harness for local chat development.

## What it covers

- two independent user panes against the public global room
- public realtime room stream
- separate realtime event-feed stream
- manual post testing with platform access tokens
- degraded-state visibility when the chat service or feed stream is unavailable

## Run it

1. Start the chat service from `chat/`
2. Serve this folder from a static file server

```bash
cd test-tools/chat
python3 -m http.server 3400
```

3. Open [http://localhost:3400](http://localhost:3400)
4. Set the chat base URL, usually `http://localhost:3200`
5. Paste platform access tokens into User A and User B
6. Start streams, send messages, and optionally publish feed events with `CHAT_FEED_TOKEN`

## Notes

- The tool consumes public read endpoints, so the room and feed streams do not need auth.
- Posting still requires valid platform-issued bearer tokens.
- Feed publishing uses the internal feed token because feed items are not human chat messages.
