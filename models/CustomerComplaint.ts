import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICustomerComplaint extends Document {
  ticketNumber: string;
  complaintType: "product" | "staff_conduct" | "service_installation" | "delivery_transit" | "billing_finance" | "other";
  
  // Accused Staff Details (For Staff / Employee Conduct Complaints)
  accusedStaffId?: string;
  accusedStaffName?: string;
  accusedStaffRole?: string;
  accusedStaffBrand?: string;

  // Customer Details
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;

  // Product / Purchase Details
  productName?: string;
  vpCode?: string;
  serialNumber?: string;
  invoiceNumber?: string;
  purchaseDate?: string;

  // Issue Details
  issueTitle: string;
  issueDescription: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "Investigating" | "Action Taken" | "Resolved" | "Closed";

  // Assignment & Routing
  assignedTo?: string;
  assignedStaffRole?: string;
  assignedDate?: string;

  // Resolution & Actions
  actionTaken?: string;
  resolutionNotes?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  customerFeedback?: string;

  createdAt: Date;
  updatedAt: Date;
}

const CustomerComplaintSchema = new Schema<ICustomerComplaint>(
  {
    ticketNumber: { type: String, required: true, unique: true, index: true },
    complaintType: {
      type: String,
      enum: ["product", "staff_conduct", "service_installation", "delivery_transit", "billing_finance", "other"],
      default: "product",
      index: true,
    },
    accusedStaffId: { type: String },
    accusedStaffName: { type: String, index: true },
    accusedStaffRole: { type: String },
    accusedStaffBrand: { type: String },

    customerName: { type: String, required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    customerEmail: { type: String, default: "" },
    customerAddress: { type: String, default: "" },

    productName: { type: String, default: "" },
    vpCode: { type: String, default: "" },
    serialNumber: { type: String, default: "" },
    invoiceNumber: { type: String, default: "", index: true },
    purchaseDate: { type: String, default: "" },

    issueTitle: { type: String, required: true },
    issueDescription: { type: String, required: true },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["Open", "Investigating", "Action Taken", "Resolved", "Closed"],
      default: "Open",
      index: true,
    },

    assignedTo: { type: String, default: "Unassigned" },
    assignedStaffRole: { type: String, default: "" },
    assignedDate: { type: String, default: "" },

    actionTaken: { type: String, default: "" },
    resolutionNotes: { type: String, default: "" },
    resolvedAt: { type: Date },
    resolvedBy: { type: String, default: "" },
    customerFeedback: { type: String, default: "" },
  },
  { timestamps: true, collection: "customer_complaints" }
);

CustomerComplaintSchema.index({ status: 1, priority: 1, createdAt: -1 });
CustomerComplaintSchema.index({ complaintType: 1, createdAt: -1 });

const CustomerComplaint: Model<ICustomerComplaint> =
  mongoose.models.CustomerComplaint || mongoose.model<ICustomerComplaint>("CustomerComplaint", CustomerComplaintSchema);

export default CustomerComplaint;
