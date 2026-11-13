/**
 * Every SALES & MONEY read of the GET paths, as a pair: `mongo` (today's query, unchanged) and `d1` (the same result
 * from the D1 copy). Both take the same arguments; the wiring step calls them through the shadow-read framework.
 * Where each one is used, its Mongo query and its result shape: lib/repo/sales/INVENTORY.md.
 *
 * `unordered: true` marks a Mongo read with no .sort(): MongoDB returns those rows in stored order or in the order of
 * whatever index the planner picks, which is not part of the query's contract. The D1 read returns the order the live
 * indexes give today (tests/d1-sales-reads.test.ts checks it exactly), but a planner change can reorder the Mongo
 * side; none of the callers depends on that order (INVENTORY.md), so a shadow comparison may compare these as sets.
 */
import { salesDb } from "./db";
import * as inv from "./invoices";
import * as money from "./money";
import * as docs from "./documents";
import * as appr from "./approvals";
import type { D1DatabaseLike } from "@/lib/d1/types";

export interface SalesRead {
  mongo: (...args: any[]) => Promise<any>;
  d1: (...args: any[]) => Promise<any>;
  /** The Mongo query has no sort: compare as a set (by _id). */
  unordered?: boolean;
}

/** Binds a d1 implementation (db first) to the area's D1 database, keeping the Mongo call's signature. */
const d1 =
  <A extends any[], R>(fn: (db: D1DatabaseLike, ...args: A) => Promise<R>) =>
  (...args: A): Promise<R> =>
    fn(salesDb(), ...args);

export const SALES_READS: Record<string, SalesRead> = {
  // invoices
  "invoices.byNumber": { mongo: inv.mongoInvoiceByNumber, d1: d1(inv.d1InvoiceByNumber) },
  "invoices.list": { mongo: inv.mongoInvoiceList, d1: d1(inv.d1InvoiceList) },
  "orders.list": { mongo: inv.mongoOrderList, d1: d1(inv.d1OrderList) },
  "payments.paidInvoices": { mongo: inv.mongoPaidInvoices, d1: d1(inv.d1PaidInvoices), unordered: true },
  "nextNumber.invoiceNumbers": { mongo: inv.mongoAllInvoiceNumbers, d1: d1(inv.d1AllInvoiceNumbers), unordered: true },
  "nextNumber.proformaNumbers": { mongo: inv.mongoProformaNumbers, d1: d1(inv.d1ProformaNumbers), unordered: true },
  "warranty.invoices": { mongo: inv.mongoNonProformaInvoices, d1: d1(inv.d1NonProformaInvoices), unordered: true },
  "vendorsLedger.customerInvoices": { mongo: inv.mongoCustomerLedgerInvoices, d1: d1(inv.d1CustomerLedgerInvoices), unordered: true },
  "track.invoice": { mongo: inv.mongoTrackInvoice, d1: d1(inv.d1TrackInvoice) },
  "salesOut.invoices": { mongo: inv.mongoSalesOut, d1: d1(inv.d1SalesOut) },
  "gstr.hsnInvoices": { mongo: inv.mongoGstrHsnInvoices, d1: d1(inv.d1GstrHsnInvoices) },
  "gstr.b2bInvoices": { mongo: inv.mongoGstrB2bInvoices, d1: d1(inv.d1GstrB2bInvoices) },
  "gstr.gstr1Invoices": { mongo: inv.mongoGstr1Invoices, d1: d1(inv.d1Gstr1Invoices) },
  "profitLoss.invoices": { mongo: inv.mongoProfitLossInvoices, d1: d1(inv.d1ProfitLossInvoices), unordered: true },
  "dashboard.invoiceSummary": { mongo: inv.mongoDashboardInvoiceSummary, d1: d1(inv.d1DashboardInvoiceSummary) },
  "dashboard.invoicesByIds": { mongo: inv.mongoInvoicesByIds, d1: d1(inv.d1InvoicesByIds), unordered: true },
  "cashRegister.cashInvoices": { mongo: inv.mongoCashInvoices, d1: d1(inv.d1CashInvoices) },
  "cashRegister.financeLinkedInvoices": { mongo: inv.mongoFinanceLinkedInvoices, d1: d1(inv.d1FinanceLinkedInvoices), unordered: true },
  "cashRegister.dueCashBills": { mongo: inv.mongoDueCashBills, d1: d1(inv.d1DueCashBills), unordered: true },
  "staffIncentive.bills": { mongo: inv.mongoIncentiveBills, d1: d1(inv.d1IncentiveBills) },
  "staffBrandSales.bills": { mongo: inv.mongoBrandSalesBills, d1: d1(inv.d1BrandSalesBills), unordered: true },
  "deliveryReminders.dueInvoices": { mongo: inv.mongoDueDeliveryInvoices, d1: d1(inv.d1DueDeliveryInvoices), unordered: true },

  // payment_transactions
  "payments.list": { mongo: money.mongoPaymentList, d1: d1(money.d1PaymentList) },
  "dashboard.supplierPayments": { mongo: money.mongoDashboardSupplierPayments, d1: d1(money.d1DashboardSupplierPayments), unordered: true },
  "dashboard.paymentSummary": { mongo: money.mongoDashboardPaymentSummary, d1: d1(money.d1DashboardPaymentSummary) },
  "dashboard.paymentsByIds": { mongo: money.mongoPaymentsByIds, d1: d1(money.d1PaymentsByIds), unordered: true },
  "cashRegister.cashReceipts": { mongo: money.mongoCashReceipts, d1: d1(money.d1CashReceipts), unordered: true },
  "vendorsLedger.payments": { mongo: money.mongoPaymentsOfPartyType, d1: d1(money.d1PaymentsOfPartyType), unordered: true },

  // customer_advances
  "advances.list": { mongo: money.mongoAdvanceList, d1: d1(money.d1AdvanceList) },

  // finance_transactions
  "finance.list": { mongo: money.mongoFinanceList, d1: d1(money.d1FinanceList) },
  "finance.reminders": { mongo: money.mongoFinanceReminders, d1: d1(money.d1FinanceReminders) },
  "dashboard.financeSummary": { mongo: money.mongoDashboardFinanceSummary, d1: d1(money.d1DashboardFinanceSummary), unordered: true },
  "cashRegister.financeRecords": { mongo: money.mongoCashRegisterFinanceRecords, d1: d1(money.d1CashRegisterFinanceRecords) },

  // deleted_invoices
  "dashboard.deletedInRange": { mongo: money.mongoDeletedInRange, d1: d1(money.d1DeletedInRange) },
  "nextNumber.deletedNumbers": { mongo: money.mongoDeletedInvoiceNumbers, d1: d1(money.d1DeletedInvoiceNumbers), unordered: true },

  // billing_companies
  "billingCompanies.list": { mongo: money.mongoBillingCompanies, d1: d1(money.d1BillingCompanies) },

  // estimates
  "estimates.list": { mongo: docs.mongoEstimateList, d1: d1(docs.d1EstimateList) },
  "nextNumber.estimateNumbers": { mongo: docs.mongoEstimateNumbers, d1: d1(docs.d1EstimateNumbers), unordered: true },

  // delivery_challans
  "challans.list": { mongo: docs.mongoChallanList, d1: d1(docs.d1ChallanList) },
  "track.challan": { mongo: docs.mongoTrackChallan, d1: d1(docs.d1TrackChallan) },

  // eway_bills
  "ewayBills.list": { mongo: docs.mongoEwayBillList, d1: d1(docs.d1EwayBillList) },
  "gstr.gstr1EwayBills": { mongo: docs.mongoGstr1EwayBills, d1: d1(docs.d1Gstr1EwayBills), unordered: true },

  // extended_warranties
  "warranty.list": { mongo: docs.mongoWarrantyList, d1: d1(docs.d1WarrantyList) },
  "warranty.count": { mongo: docs.mongoWarrantyCount, d1: d1(docs.d1WarrantyCount) },
  "warranty.revenue": { mongo: docs.mongoWarrantyRevenue, d1: d1(docs.d1WarrantyRevenue) },
  "warranty.todayCount": { mongo: docs.mongoWarrantyTodayCount, d1: d1(docs.d1WarrantyTodayCount) },
  "warranty.monthCount": { mongo: docs.mongoWarrantyMonthCount, d1: d1(docs.d1WarrantyMonthCount) },

  // discountapprovals
  "discountApprovals.byIds": { mongo: appr.mongoDiscountApprovalsByIds, d1: d1(appr.d1DiscountApprovalsByIds), unordered: true },
  "discountApprovals.list": { mongo: appr.mongoDiscountApprovalList, d1: d1(appr.d1DiscountApprovalList) },

  // store_activity_approvals
  "approvals.list": { mongo: appr.mongoStoreApprovals, d1: d1(appr.d1StoreApprovals) },
  "meSummary.pendingApprovals": { mongo: appr.mongoPendingStoreApprovalCount, d1: d1(appr.d1PendingStoreApprovalCount) },
};
