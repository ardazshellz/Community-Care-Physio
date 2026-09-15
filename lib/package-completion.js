// Old browser tabs must not reapply a completed flag to an unfinished package.
export function reconcilePackageCompletion(update, booking) {
  const sizes={'Block of 4 Sessions':4,'Block of 6 Sessions':6,'Starter Programme':4,'Full Programme':6};
  const expected=sizes[booking.appointment] || Number(String(booking.appointment||'').match(/(\d+)\s*(?:sessions?|follow)/i)?.[1]) || 0;
  const sessions=update.custom_sessions;
  const complete=sessions.length>0 && sessions.length>=expected && sessions.every(s=>['completed','dna'].includes(s.status));
  if(!complete){
    sessions.forEach(s=>{delete s.packageCompletedAt;});
    const status=update.status || booking.status;
    if(status==='completed')update.status=booking.paid!==false?'prepaid':'pending';
  }
  return update;
}
