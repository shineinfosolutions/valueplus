import mongoose, { Schema, Document } from "mongoose";

export interface IExpense extends Document {
  expenseNo: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paymentMode: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema: Schema = new Schema(
  {
    expenseNo: { type: String, required: true, unique: true },
    category: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    paymentMode: { type: String, required: true },
    status: { type: String, required: true, default: "paid" },
  },
  { timestamps: true }
);

export default mongoose.models.Expense || mongoose.model<IExpense>("Expense", ExpenseSchema);
