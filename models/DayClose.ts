import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDayClose extends Document {
  date: string; // YYYY-MM-DD, one record per business day
  openingCash: number;
  /** Snapshot of the cash-register's computed balance at the moment of closing —
   *  what the system expects the drawer to hold, for comparison against the
   *  physical count below. */
  systemExpectedCash: number;
  /** The register at the start of the day, the cash that came in (and how much of it
   *  from bills) and went out during that day. Absent on audits made before these existed. */
  systemOpeningCash?: number;
  dayCashIn?: number;
  dayCashFromInvoices?: number;
  dayCashOut?: number;
  /** Kept when an old audit was recalculated by day, so the first figures are not lost. */
  originalSystemExpectedCash?: number;
  originalDifference?: number;
  recalculatedAt?: string;
  recalculatedBy?: string;
  countedCash: number;
  /** How the counted cash was made up, note by note. Absent on audits recorded
   *  before the note-wise count existed. */
  denominations?: { value: number; count: number }[];
  coinsAmount?: number;
  difference: number;
  notes?: string;
  closedBy: string;
  closedByRole?: string;
  closedAt: string;
}

const DayCloseSchema = new Schema<IDayClose>(
  {
    date: { type: String, required: true, unique: true },
    openingCash: { type: Number, default: 0 },
    systemExpectedCash: { type: Number, required: true },
    systemOpeningCash: { type: Number },
    dayCashIn: { type: Number },
    dayCashFromInvoices: { type: Number },
    dayCashOut: { type: Number },
    originalSystemExpectedCash: { type: Number },
    originalDifference: { type: Number },
    recalculatedAt: { type: String },
    recalculatedBy: { type: String },
    countedCash: { type: Number, required: true },
    denominations: {
      type: [{ _id: false, value: { type: Number, required: true }, count: { type: Number, required: true } }],
      default: [],
    },
    coinsAmount: { type: Number, default: 0 },
    difference: { type: Number, required: true },
    notes: { type: String, default: "" },
    closedBy: { type: String, required: true },
    closedByRole: { type: String, default: "" },
    closedAt: { type: String, required: true },
  },
  { timestamps: true, collection: "day_closes" }
);

const DayClose: Model<IDayClose> = mongoose.models.DayClose || mongoose.model<IDayClose>("DayClose", DayCloseSchema);
export default DayClose;
