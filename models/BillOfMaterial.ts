import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBOMComponent {
  itemId: mongoose.Types.ObjectId;
  itemName: string;
  quantity: number;
  cost: number;
}

export interface IBillOfMaterial extends Document {
  bomNumber: string;
  finishedGoodItemId: mongoose.Types.ObjectId;
  finishedGoodName: string;
  expectedQuantity: number;
  components: IBOMComponent[];
  totalCost: number;
}

const BOMComponentSchema = new Schema<IBOMComponent>({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  cost: { type: Number, default: 0 },
});

const BillOfMaterialSchema = new Schema<IBillOfMaterial>(
  {
    bomNumber: { type: String, required: true, unique: true },
    finishedGoodItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    finishedGoodName: { type: String, required: true },
    expectedQuantity: { type: Number, required: true, min: 1 },
    components: [BOMComponentSchema],
    totalCost: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "bill_of_materials" }
);

const BillOfMaterial: Model<IBillOfMaterial> = mongoose.models.BillOfMaterial || mongoose.model<IBillOfMaterial>("BillOfMaterial", BillOfMaterialSchema);
export default BillOfMaterial;
