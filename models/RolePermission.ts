import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Optional per-role override of the defaults in lib/permissions.ts.
 *
 * The collection is empty until an admin edits something on /settings/roles, and
 * an empty collection means "use the defaults" — so no seeding or migration is
 * needed for the permission checks to start working.
 */
export interface IRolePermission extends Document {
  role: string;
  permissions: string[];
  updatedBy?: string;
}

const RolePermissionSchema = new Schema<IRolePermission>(
  {
    role: { type: String, required: true, unique: true, lowercase: true, trim: true },
    permissions: [{ type: String }],
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "role_permissions" }
);

const RolePermission: Model<IRolePermission> =
  mongoose.models.RolePermission ||
  mongoose.model<IRolePermission>("RolePermission", RolePermissionSchema);
export default RolePermission;
