import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionActor } from "@/lib/requirePermission";

/**
 * While the Admin's approval of a Store Manager's request is being carried out, the request's route is run again
 * inside this context: the person doing it is the approving Admin, and the PIN / "send to the Admin" checks that
 * the Manager already went through are not asked again.
 */
export const deferredContext = new AsyncLocalStorage<{ approver: SessionActor }>();
