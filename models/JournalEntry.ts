import mongoose, { Schema, Document, Model } from "mongoose";

export interface IJournalLine {
  accountId: mongoose.Types.ObjectId;
  accountName: string;
  debit: number;
  credit: number;
}

export interface IJournalEntry extends Document {
  entryNumber: string;
  date: string;
  description: string;
  referenceType?: string; // e.g. "Invoice", "Bill", "Manual"
  referenceId?: string;
  lines: IJournalLine[];
  totalDebit: number;
  totalCredit: number;
}

const JournalLineSchema = new Schema<IJournalLine>({
  accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
  accountName: { type: String, required: true },
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
});

const JournalEntrySchema = new Schema<IJournalEntry>(
  {
    entryNumber: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    description: { type: String, required: true },
    referenceType: { type: String },
    referenceId: { type: String },
    lines: [JournalLineSchema],
    totalDebit: { type: Number, required: true },
    totalCredit: { type: Number, required: true },
  },
  { timestamps: true, collection: "journal_entries" }
);

const JournalEntry: Model<IJournalEntry> = mongoose.models.JournalEntry || mongoose.model<IJournalEntry>("JournalEntry", JournalEntrySchema);
export default JournalEntry;
