import mongoose, { Schema, Document } from "mongoose";

export interface IStockTransfer extends Document {
  transferNo: string;
  fromWarehouse: string;
  toWarehouse: string;
  /** Real refs, resolved at creation time — the name strings above are kept only
   *  for historical display (so an old record still reads sensibly even if a
   *  warehouse is later renamed), never used for stock-movement lookups. */
  fromWarehouseId?: mongoose.Types.ObjectId;
  toWarehouseId?: mongoose.Types.ObjectId;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unit: string;
    /** Item.purchasePrice snapshotted at transfer time — the cost of the goods
     *  moving between our own warehouses, never a sale/selling price, since
     *  moving stock internally isn't a sale. */
    costPrice: number;
  }>;
  /** Sum of qty * costPrice across all lines — same reasoning as costPrice above. */
  totalValue: number;
  date: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const StockTransferSchema: Schema = new Schema(
  {
    transferNo: { type: String, required: true, unique: true },
    fromWarehouse: { type: String, required: true },
    toWarehouse: { type: String, required: true },
    fromWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    toWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    items: [
      {
        itemId: { type: String, required: true },
        itemName: { type: String, required: true },
        quantity: { type: Number, required: true },
        unit: { type: String, default: "PCS" },
        costPrice: { type: Number, default: 0 },
      }
    ],
    totalValue: { type: Number, default: 0 },
    date: { type: String, required: true },
    status: { type: String, required: true, default: "in-transit" },
  },
  { timestamps: true }
);

if (mongoose.models.StockTransfer) {
  delete mongoose.models.StockTransfer;
}
export default mongoose.model<IStockTransfer>("StockTransfer", StockTransferSchema);
