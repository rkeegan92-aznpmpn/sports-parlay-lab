import { copyFileSync, constants } from 'node:fs';
const app = new URL('../nfl-parlay-lab/', import.meta.url);
try {
  copyFileSync(new URL('.env.example', app), new URL('.env.local', app), constants.COPYFILE_EXCL);
  console.log('Created private app .env.local. Set ODDS_API_KEY there; never commit it.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env.local preserved without modification.');
}
