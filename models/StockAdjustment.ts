import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStockAdjustmentItem {
  itemId: string;
  itemName: string;
  quantity: number;
  type: "in" | "out";
  remarks?: string;
}

export interface IStockAdjustment extends Document {
  adjustmentNo: string;
  date: string;
  reason: string;
  /** Which warehouse this adjustment's quantities apply to — one adjustment
   *  covers one warehouse, matching how the form already groups items. Optional
   *  at the schema level so historical adjustments made before this field
   *  existed don't fail validation; new adjustments require it in the route. */
  warehouseId?: mongoose.Types.ObjectId;
  items: IStockAdjustmentItem[];
}

const StockAdjustmentItemSchema = new Schema<IStockAdjustmentItem>({
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ["in", "out"], required: true },
  remarks: { type: String },
});

const StockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    adjustmentNo: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    reason: { type: String, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    items: [StockAdjustmentItemSchema],
  },
  { timestamps: true, collection: "stock_adjustments" }
);

if (mongoose.models.StockAdjustment) {
  delete mongoose.models.StockAdjustment;
}

const StockAdjustment: Model<IStockAdjustment> = mongoose.model<IStockAdjustment>("StockAdjustment", StockAdjustmentSchema);
export default StockAdjustment;
