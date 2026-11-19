/** An explicit ISO offset is required. Never guess a provider timestamp's local zone. */
export function providerTimestamp(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const text=value.trim(),m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(text);
 if(!m)return null;
 const [year,month,day,hour,minute,second]=[m[1],m[2],m[3],m[4],m[5],m[6]??'0'].map(Number);
 const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);
 if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hour>23||minute>59||second>59)return null;
 let iso=text.replace(' ','T').replace(/z$/i,'Z');
 if(/[+-]\d{2}$/.test(iso))iso+=':00'; // ISO 8601 hour-only offsets, e.g. +00.
 else iso=iso.replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
 const at=Date.parse(iso);return Number.isFinite(at)?new Date(at).toISOString():null;
}
