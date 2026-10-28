import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStaffTask extends Document {
  taskTitle: string;
  assignedStaff: string;
  assignedStaffId?: string;
  assignedDate: string; // e.g. "2026-08-24"
  dueDate: string; // e.g. "2026-08-25"
  dueTime?: string; // e.g. "18:00"
  priority: "Low" | "Medium" | "High" | "Urgent";
  description: string;
  reminder?: boolean;
  status: "Pending" | "In Progress" | "Completed" | "Overdue";
  
  // Sales Target & Auto-Completion Fields
  taskType: "general" | "sales_target" | "follow_up" | "product_demo";
  targetProduct?: string; // e.g. "Haier 1.5 Ton Inverter AC"
  targetBrand?: string; // e.g. "Haier"
  targetQty?: number; // e.g. 2 units
  targetAmount?: number; // e.g. 50000
  currentQty: number; // e.g. 1
  currentAmount: number; // e.g. 25000
  linkedInvoiceNumber?: string; // e.g. "INV-2026-0042"

  createdBy: string;
  completedAt?: Date;
  completionRemarks?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StaffTaskSchema = new Schema<IStaffTask>(
  {
    taskTitle: { type: String, required: true },
    assignedStaff: { type: String, required: true, index: true },
    assignedStaffId: { type: String },
    assignedDate: {
      type: String,
      default: () => {
        try {
          return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        } catch (e) {
          return new Date().toISOString().split("T")[0];
        }
      },
      index: true,
    },
    dueDate: { type: String, required: true, index: true },
    dueTime: { type: String, default: "18:00" },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    description: { type: String, default: "" },
    reminder: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed", "Overdue"],
      default: "Pending",
      index: true,
    },

    taskType: {
      type: String,
      enum: ["general", "sales_target", "follow_up", "product_demo"],
      default: "general",
      index: true,
    },
    targetProduct: { type: String, default: "" },
    targetBrand: { type: String, default: "" },
    targetQty: { type: Number, default: 0 },
    targetAmount: { type: Number, default: 0 },
    currentQty: { type: Number, default: 0 },
    currentAmount: { type: Number, default: 0 },
    linkedInvoiceNumber: { type: String, default: "" },

    createdBy: { type: String, default: "Admin" },
    completedAt: { type: Date },
    completionRemarks: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true, collection: "staff_tasks" }
);

StaffTaskSchema.index({ assignedStaff: 1, status: 1 });
StaffTaskSchema.index({ taskType: 1, status: 1 });

const StaffTask: Model<IStaffTask> =
  mongoose.models.StaffTask || mongoose.model<IStaffTask>("StaffTask", StaffTaskSchema);

export default StaffTask;
