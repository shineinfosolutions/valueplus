/** Today's date (YYYY-MM-DD) in India time. `new Date().toISOString()` is UTC,
 *  so between midnight and 5:30 am IST it gives yesterday's date. */
export const todayInIndia = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
