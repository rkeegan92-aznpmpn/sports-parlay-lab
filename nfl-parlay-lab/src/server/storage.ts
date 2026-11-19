import path from 'node:path';

export function databaseFile(env: { DB_PATH?: string; REQUIRE_PERSISTENT_DB?: string } = { DB_PATH: process.env.DB_PATH, REQUIRE_PERSISTENT_DB: process.env.REQUIRE_PERSISTENT_DB }): string {
  const file = env.DB_PATH?.trim() || './data/parlay.db';
  if (env.REQUIRE_PERSISTENT_DB === '1' &&
      (!path.isAbsolute(file) || file === ':memory:' || /^\/(?:tmp|var\/tmp)(?:\/|$)/.test(path.resolve(file)))) {
    throw new Error('Persistent storage requires an absolute DB_PATH on the mounted data disk.');
  }
  return file;
}
