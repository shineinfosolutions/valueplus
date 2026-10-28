import { NextResponse } from "next/server";
import { getActor } from "@/lib/requirePermission";

/**
 * The signed-in user's effective permissions, for the client to hide controls it
 * knows will be refused. This is a convenience only — every protected route still
 * checks for itself, so a tampered client gains nothing.
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: true, data: { role: "", permissions: [] } });
    }
    return NextResponse.json({
      success: true,
      data: { role: actor.role, name: actor.name, permissions: actor.permissions },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
