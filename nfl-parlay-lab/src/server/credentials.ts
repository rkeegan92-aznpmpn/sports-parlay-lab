import { createHash } from 'node:crypto';
/** One-way identity only; never return key characters, URLs, or contents. */
export function credentialFingerprint(key:string|undefined):string|null {
  return key?.trim()?createHash('sha256').update(key.trim()).digest('hex').slice(0,16):null;
}
export const liveCacheKey=(key:string)=>`live:pipeline-v4:${credentialFingerprint(key)}:ALL`;
