import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDeliveryChallan extends Document {
  challanNo: string;
  type: "Outward Delivery" | "Customer Return" | "Warehouse Return" | "Supplier Return" | "Client Return";
  invoiceNumber?: string;
  sourceParty: string;
  sourceAddress: string;
  sourcePhone?: string;
  destinationParty: string;
  destinationAddress: string;
  customerPhone?: string;
  itemName: string;
  vpCode?: string;
  hsn: string;
  serialImei: string;
  quantity: number;
  unit: string;
  itemPrice?: number;
  defectDescription?: string;
  financeDoId?: string;
  reason: string;
  date: Date;
  vehicleNo: string;
  transporterName?: string;
  driverName: string;
  driverPhone: string;
  ewayBillNo?: string;
  flowType?: "CNR" | "PR";
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedAt?: Date;
  approvedBy?: string;
  creditNoteRef?: string;
  deliveryOtp?: string;
  deliveredAt?: Date;
  status: "dispatched" | "in-transit" | "delivered" | "returned" | "received";
  remarks?: string;
}

const DeliveryChallanSchema = new Schema<IDeliveryChallan>(
  {
    challanNo: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ["Outward Delivery", "Customer Return", "Warehouse Return", "Supplier Return", "Client Return"],
      default: "Customer Return",
    },
    invoiceNumber: { type: String, index: true },
    sourceParty: { type: String, default: "M/S ASHOKA ENTERPRISES" },
    sourceAddress: { type: String, default: "H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR" },
    sourcePhone: { type: String, default: "" },
    destinationParty: { type: String, required: true },
    destinationAddress: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    itemName: { type: String, required: true },
    vpCode: { type: String, default: "" },
    hsn: { type: String, default: "" },
    serialImei: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    unit: { type: String, default: "PCS" },
    itemPrice: { type: Number, default: 0 },
    defectDescription: { type: String, default: "" },
    financeDoId: { type: String, default: "" },
    reason: { type: String, default: "Defective Replacement / Return" },
    date: { type: Date, default: Date.now },
    vehicleNo: { type: String, default: "" },
    transporterName: { type: String, default: "" },
    driverName: { type: String, default: "" },
    driverPhone: { type: String, default: "" },
    ewayBillNo: { type: String, default: "" },
    flowType: {
      type: String,
      enum: ["CNR", "PR"],
      default: "CNR",
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    approvedAt: { type: Date },
    approvedBy: { type: String, default: "" },
    creditNoteRef: { type: String, default: "" },
    debitNoteRef: { type: String, default: "" },
    deliveryOtp: { type: String, default: "" },
    deliveredAt: { type: Date },
    status: {
      type: String,
      enum: ["dispatched", "in-transit", "delivered", "returned", "received"],
      default: "dispatched",
    },
    remarks: { type: String, default: "" },
  },
  { timestamps: true, collection: "delivery_challans" }
);

if (mongoose.models.DeliveryChallan) {
  delete mongoose.models.DeliveryChallan;
}
const DeliveryChallan: Model<IDeliveryChallan> = mongoose.model<IDeliveryChallan>("DeliveryChallan", DeliveryChallanSchema);

export default DeliveryChallan;

