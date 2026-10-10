/**
 * Validates req[source] against a Zod schema and stores the parsed result on
 * req.valid[source]. Handlers read only from req.valid, so unvalidated input
 * never reaches SQL. Zod errors are turned into 400s by the error handler.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    req.valid ??= {};
    req.valid[source] = schema.parse(req[source] ?? {});
    next();
  };
}
