/** Arguments of the STAFF & SYSTEM reads that a route builds from its request (see lib/repo/staff/mongo.ts). */

export interface AttendanceListArgs {
  /** ?date= ("all" = any day) */
  dateParam?: string | null;
  /** ?staff= ("all" = everyone) */
  staffName?: string | null;
  staffId?: string | null;
  /** ?month=YYYY-MM (a regex prefix on `date`, as the route has it) */
  month?: string | null;
  /** the route's getISTDate(), used when neither date nor month is given */
  today: string;
}

export interface LeaveListArgs {
  status?: string | null;
  /** only this person's requests (by id or by name) */
  mineOf?: { id: string; name: string } | null;
  /** only these kinds (the "decidable" view); ignored when mineOf is set */
  kinds?: string[] | null;
}

export interface TaskListArgs {
  actor: { id: string; name: string; role: string };
  /** ?staff= */
  staff?: string | null;
  /** ?status= */
  status?: string | null;
}

export interface AuditListArgs {
  action?: string | null;
  from?: string | null;
  to?: string | null;
  refs?: string | null;
  q?: string | null;
  limit?: string | number | null;
}
