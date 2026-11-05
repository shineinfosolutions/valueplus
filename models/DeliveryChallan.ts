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
  /**
   * How a defective-return claim was settled (Supplier Return / Customer Return only), chosen when the result comes:
   *   CR — the supplier gave money: a debit note is raised in the supplier's name and sits in his ledger as credit,
   *        so it comes off the next purchase bill.
   *   PR — a replacement product came (from the supplier), or was given (to the customer).
   * Empty while the claim is pending. "CNR" is the old name of CR on challans made before this change.
   */
  flowType?: "CR" | "PR" | "CNR" | "";
  /** Settlement of a Supplier / Customer Return claim. */
  claimStatus?: "pending" | "settled" | "cancelled";
  settledAt?: Date;
  settledBy?: string;
  /** CR: the amount the supplier credited, and the debit note raised for it. */
  creditAmount?: number;
  debitNoteRef?: string;
  /** PR: the product and serial that replaced the defective unit. */
  replacementItemId?: string;
  replacementItemName?: string;
  replacementSerial?: string;
  /** The product (catalog id), supplier and warehouse the defective unit belongs to. */
  itemId?: string;
  supplierId?: string;
  warehouse?: string;
  settlementNote?: string;
  createdBy?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedAt?: Date;
  approvedBy?: string;
  creditNoteRef?: string;
  deliveryOtp?: string;
  deliveredAt?: Date;
  deliveryProofKey?: string;
  deliveryProofKeys?: string[];
  /** True for the challan the system makes by itself when a bill has a delivery / vehicle (shown under Pending Delivery). */
  autoFromBill?: boolean;
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
      enum: ["CR", "PR", "CNR", ""],
      default: "",
      index: true,
    },
    claimStatus: { type: String, enum: ["pending", "settled", "cancelled"], index: true },
    settledAt: { type: Date },
    settledBy: { type: String, default: "" },
    creditAmount: { type: Number, default: 0 },
    replacementItemId: { type: String, default: "" },
    replacementItemName: { type: String, default: "" },
    replacementSerial: { type: String, default: "" },
    itemId: { type: String, default: "" },
    supplierId: { type: String, default: "" },
    warehouse: { type: String, default: "" },
    settlementNote: { type: String, default: "" },
    createdBy: { type: String, default: "" },
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
    deliveryProofKey: { type: String, default: "" },
    deliveryProofKeys: { type: [String], default: [] },
    autoFromBill: { type: Boolean, default: false },
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

