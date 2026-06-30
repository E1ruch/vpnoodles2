// Минимальные env-значения для юнит-тестов, чтобы zod-схема конфига проходила.
// Реальные значения подставляются только в боевых окружениях.
process.env['NODE_ENV'] = process.env['NODE_ENV'] || 'test';
process.env['TELEGRAM_BOT_TOKEN'] = process.env['TELEGRAM_BOT_TOKEN'] || 'test-token';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/vpnoodles_test';
process.env['REMNAWAVE_API_URL'] = process.env['REMNAWAVE_API_URL'] || 'http://localhost';
process.env['REMNAWAVE_API_KEY'] = process.env['REMNAWAVE_API_KEY'] || 'test-key';
