// Runs before any app module is imported, so config.js sees test settings.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://outreach:outreach@localhost:55432/outreach_test';
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789';
process.env.PSEUDONYM_SECRET = 'test-pseudonym-secret-0123456789abcdef01';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing in tests only
