import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStockJournalItem {
  itemId: mongoose.Types.ObjectId;
  itemName: string;
  warehouseId?: mongoose.Types.ObjectId;
  quantity: number;
  type: "in" | "out";
}

export interface IStockJournal extends Document {
  journalNumber: string;
  date: string;
  purpose: string;
  items: IStockJournalItem[];
}

const StockJournalItemSchema = new Schema<IStockJournalItem>({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemName: { type: String, required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  quantity: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ["in", "out"], required: true },
});

const StockJournalSchema = new Schema<IStockJournal>(
  {
    journalNumber: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    purpose: { type: String, required: true },
    items: [StockJournalItemSchema],
  },
  { timestamps: true, collection: "stock_journals" }
);

const StockJournal: Model<IStockJournal> = mongoose.models.StockJournal || mongoose.model<IStockJournal>("StockJournal", StockJournalSchema);
export default StockJournal;
