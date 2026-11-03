import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * The cash register's starting figure. It used to be a fixed 2,00,000 in the code,
 * which was never real cash. The Admin now sets it by entering the cash actually in
 * the drawer; the system works out the starting figure from that and the recorded
 * movements, so the register shows the real amount from then on.
 */
export interface ICashRegisterSetting extends Document {
  key: string;
  openingCash: number;
  /** The drawer count the Admin entered, and when / by whom. */
  countedCash?: number;
  calibratedBy?: string;
  calibratedAt?: string;
}

const CashRegisterSettingSchema = new Schema<ICashRegisterSetting>(
  {
    key: { type: String, required: true, unique: true, default: "cash-register" },
    openingCash: { type: Number, default: 0 },
    countedCash: { type: Number },
    calibratedBy: { type: String },
    calibratedAt: { type: String },
  },
  { timestamps: true, collection: "cash_register_settings" }
);

const CashRegisterSetting: Model<ICashRegisterSetting> =
  mongoose.models.CashRegisterSetting || mongoose.model<ICashRegisterSetting>("CashRegisterSetting", CashRegisterSettingSchema);
export default CashRegisterSetting;
