import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStockReturnItem {
  itemId: mongoose.Types.ObjectId | string;
  itemName: string;
  quantity: number;
  reason?: string;
}

export interface IStockReturn extends Document {
  returnNumber: string;
  date: string;
  returnType: "Customer Return" | "Supplier Return";
  referenceId?: string; // Invoice ID or Purchase Entry ID
  items: IStockReturnItem[];
  status: "Pending" | "Completed";
}

const StockReturnItemSchema = new Schema<IStockReturnItem>({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  reason: { type: String },
});

const StockReturnSchema = new Schema<IStockReturn>(
  {
    returnNumber: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    returnType: { type: String, enum: ["Customer Return", "Supplier Return"], required: true },
    referenceId: { type: String },
    items: [StockReturnItemSchema],
    status: { type: String, enum: ["Pending", "Completed"], default: "Completed" },
  },
  { timestamps: true, collection: "stock_returns" }
);

if (mongoose.models.StockReturn) {
  delete mongoose.models.StockReturn;
}
const StockReturn: Model<IStockReturn> = mongoose.model<IStockReturn>("StockReturn", StockReturnSchema);
export default StockReturn;
