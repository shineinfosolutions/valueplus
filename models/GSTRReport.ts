import mongoose, { Schema, Document, Model } from "mongoose";

export interface IGSTRReport extends Document {
  reportId: string;
  type: "GSTR1" | "GSTR2";
  date: string;
  partyName: string;
  gstin: string;
  amount: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalTax: number;
}

const GSTRReportSchema = new Schema<IGSTRReport>(
  {
    reportId: { type: String, required: true },
    type: { type: String, enum: ["GSTR1", "GSTR2"], required: true },
    date: { type: String, required: true },
    partyName: { type: String, required: true },
    gstin: { type: String, default: "" },
    amount: { type: Number, required: true },
    igst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "gstr_reports" }
);

const GSTRReport: Model<IGSTRReport> = mongoose.models.GSTRReport || mongoose.model<IGSTRReport>("GSTRReport", GSTRReportSchema);
export default GSTRReport;
