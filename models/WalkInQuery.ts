import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWalkInQuery extends Document {
  customerName: string;
  mobile: string;
  date: string;
  time: string;
  reason:
    | "Product Enquiry"
    | "Purchase"
    | "Price Enquiry"
    | "Exchange"
    | "Warranty"
    | "Service"
    | "Finance"
    | "Complaint"
    | "Other";
  interestedProduct: string;
  category: string;
  budget?: number;
  staff: string;
  notes?: string;
  followUpDate?: string;
  status: "Open" | "Converted to Lead" | "Closed" | "Lost";
  leadId?: string;
}

const WalkInQuerySchema = new Schema<IWalkInQuery>(
  {
    customerName: { type: String, required: true },
    mobile: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    // India time: the server runs in UTC, which showed a 11:53 am visit as 06:23 am.
    time: {
      type: String,
      default: () =>
        new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }),
    },
    reason: {
      type: String,
      enum: [
        "Product Enquiry",
        "Purchase",
        "Price Enquiry",
        "Exchange",
        "Warranty",
        "Service",
        "Finance",
        "Complaint",
        "Other",
      ],
      default: "Product Enquiry",
    },
    interestedProduct: { type: String, required: true },
    category: { type: String, default: "Electronics" },
    budget: { type: Number, default: 0 },
    staff: { type: String, default: "Sales Executive" },
    notes: { type: String, default: "" },
    followUpDate: { type: String },
    status: {
      type: String,
      enum: ["Open", "Converted to Lead", "Closed", "Lost"],
      default: "Open",
    },
    leadId: { type: String },
  },
  { timestamps: true, collection: "walk_in_queries" }
);

if (mongoose.models.WalkInQuery) {
  delete mongoose.models.WalkInQuery;
}
const WalkInQuery: Model<IWalkInQuery> = mongoose.model<IWalkInQuery>("WalkInQuery", WalkInQuerySchema);
export default WalkInQuery;
