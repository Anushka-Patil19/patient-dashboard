import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

const PG_ERRORS = {
  23505: [409, 'DUPLICATE', 'A record with these details already exists'],
  23503: [422, 'INVALID_REFERENCE', 'A referenced record does not exist'],
  23514: [400, 'CONSTRAINT_VIOLATION', 'One or more values are outside the allowed range'],
  '22P02': [400, 'BAD_REQUEST', 'Malformed identifier or value'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (err.code && PG_ERRORS[err.code]) {
    const [status, code, message] = PG_ERRORS[err.code];
    return res.status(status).json({ error: { code, message } });
  }

  // Unexpected: log full detail server-side, return nothing internal to the client.
  console.error(`[${req.id}]`, err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
}
