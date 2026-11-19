/** NFL slate dates use Eastern civil dates, including Sunday-night UTC rollover. */
export function nflDate(iso:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
export function nextSundayDate(now=Date.now()){
 const date=nflDate(new Date(now).toISOString()),day=new Date(`${date}T12:00:00Z`),days=(7-day.getUTCDay())%7;
 day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);
}
export function inSundayWindow(kickoff:string,now:number){return Date.parse(kickoff)>now&&nflDate(kickoff)===nextSundayDate(now);}
