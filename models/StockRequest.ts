import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStockRequestItem {
  itemId: mongoose.Types.ObjectId;
  itemName: string;
  requestedQty: number;
}

export interface IStockRequest extends Document {
  requestNumber: string;
  date: string;
  requestingWarehouseId?: mongoose.Types.ObjectId;
  supplyingWarehouseId?: mongoose.Types.ObjectId;
  items: IStockRequestItem[];
  status: "Pending" | "Approved" | "Fulfilled" | "Rejected";
}

const StockRequestItemSchema = new Schema<IStockRequestItem>({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemName: { type: String, required: true },
  requestedQty: { type: Number, required: true, min: 1 },
});

const StockRequestSchema = new Schema<IStockRequest>(
  {
    requestNumber: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    requestingWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    supplyingWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    items: [StockRequestItemSchema],
    status: { type: String, enum: ["Pending", "Approved", "Fulfilled", "Rejected"], default: "Pending" },
  },
  { timestamps: true, collection: "stock_requests" }
);

const StockRequest: Model<IStockRequest> = mongoose.models.StockRequest || mongoose.model<IStockRequest>("StockRequest", StockRequestSchema);
export default StockRequest;
