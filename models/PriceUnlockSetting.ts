import mongoose, { Schema, Document, Model } from "mongoose";

/** The one Admin-set PIN that lets an estimate go below a product's locked minimum price. */
export interface IPriceUnlockSetting extends Document {
  key: string;
  pinHash?: string;
  updatedBy?: string;
  updatedAt?: Date;
}

const PriceUnlockSettingSchema = new Schema<IPriceUnlockSetting>(
  {
    key: { type: String, required: true, unique: true, default: "price-unlock" },
    pinHash: { type: String },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "price_unlock_settings" }
);

const PriceUnlockSetting: Model<IPriceUnlockSetting> =
  mongoose.models.PriceUnlockSetting ||
  mongoose.model<IPriceUnlockSetting>("PriceUnlockSetting", PriceUnlockSettingSchema);
export default PriceUnlockSetting;
