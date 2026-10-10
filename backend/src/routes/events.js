import { Router } from 'express';
import { bus } from '../lib/events.js';

const router = Router();

/**
 * Server-Sent Events stream of change notifications. Clients connect with
 * fetch() so the Bearer token travels in a header (EventSource cannot set
 * headers, and tokens in URLs leak into logs). The stream is closed when the
 * access token expires; the client reconnects with a refreshed token, so a
 * revoked session cannot keep listening indefinitely.
 */
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx / Render)
  });
  res.write('retry: 5000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);

  const onChange = (event) => res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  bus.on('change', onChange);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  const expiry = setTimeout(() => res.end(), Math.max(0, req.tokenExpiresAt - Date.now()));

  req.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    bus.off('change', onChange);
  });
});

export default router;
