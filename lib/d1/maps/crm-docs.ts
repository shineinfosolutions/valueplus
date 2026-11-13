import { canonicalJson, idText, toBool, toDate, toInt, toJson, toReal, toText, type MasterSpec, type SqlValue } from "../masters-map";

/**
 * D1 copy specs for this area (see docs/D1_MIGRATION_PLAN.md). Each entry maps one Mongo collection to its
 * D1 table (migration in d1/migrations/). Picked up by lib/d1/registry.ts, so the copy job (lib/d1/sync.ts)
 * copies it with no other change.
 *
 * CRM, documents and accounting (migration 0005_crm_docs.sql):
 *  - leads (+ child tables leadFollowUps, leadCalls, leadShares; `items` and `timeline` stay JSON, plan §4.7),
 *    walkInQueries, customerComplaints;
 *  - whatsappMessages, whatsappSettings (`cloudApi` flattened; the access token is copied as it is, plan §4.2/§4.8);
 *  - storedDocuments, documentFolders, onsitegoPlans;
 *  - gstrReports, journalEntries (+ child table journalEntryLines), accounts (plan §4.5 / §4.2).
 *
 * Lossless on odd data: besides the unknown fields the engine keeps, `extraFields` keeps in `extra` the original of
 * any known field its column cannot hold faithfully (a number written as text, a Date column holding a string, a
 * legacy non-array where a child array is expected, a non-object `cloudApi`). Child rows have their own `extra` for
 * unknown keys / misfit values of each array element, and an `idx` (position in the Mongo array) so order survives.
 */

type ColType = MasterSpec["columns"][number]["type"];
type Field = [name: string, type: ColType];

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.prototype.toString.call(v) === "[object Object]" && !(v as any)._bsontype;
}

function isObjectIdLike(v: any): boolean {
  return !!v && typeof v === "object" && (v._bsontype === "ObjectId" || v._bsontype === "ObjectID");
}

function convert(type: ColType, v: unknown): SqlValue {
  switch (type) {
    case "text":
      return toText(v);
    case "real":
      return toReal(v);
    case "int":
      return toInt(v);
    case "bool":
      return toBool(v);
    case "date":
      return toDate(v);
    case "json":
      return toJson(v);
  }
}

/**
 * Whether a column of this type holds the Mongo value as it is (so nothing needs keeping in `extra`). Missing and
 * null both read back as NULL. A reference held as an ObjectId fits a text column (stored as its 24-hex text).
 */
function fits(type: ColType, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  switch (type) {
    case "text":
      return typeof v === "string" || isObjectIdLike(v);
    case "real":
      return typeof v === "number" && Number.isFinite(v);
    case "int":
      return typeof v === "number" && Number.isInteger(v);
    case "bool":
      return typeof v === "boolean";
    case "date":
      return Object.prototype.toString.call(v) === "[object Date]" && Number.isFinite((v as Date).getTime());
    case "json":
      return true;
  }
}

const col = (name: string, type: ColType) => ({ col: name, type, get: (d: any) => d?.[name] });

/** A field of a flattened 1:1 subdocument, column `${parent}_${field}`. */
const subCol = (parent: string, field: string, type: ColType) => ({
  col: `${parent}_${field}`,
  type,
  get: (d: any) => (isPlainObject(d?.[parent]) ? d[parent][field] : undefined),
});

interface ChildDef {
  table: string;
  /** The Mongo array field. */
  field: string;
  parentCol: string;
  /** Column for the element's own `_id` (journal lines have one), when it has one. */
  idCol?: string;
  fields: Field[];
}

function childColumns(c: ChildDef): string[] {
  return [c.parentCol, "idx", ...(c.idCol ? [c.idCol] : []), ...c.fields.map(([n]) => n), "extra"];
}

/** One row per array element, in array order. A non-object element is kept whole in `extra` as {"$value": ...}. */
function childRows(c: ChildDef) {
  return (doc: any, id: string): SqlValue[][] => {
    const list = doc?.[c.field];
    if (!Array.isArray(list)) return [];
    return list.map((el, idx) => {
      const row: SqlValue[] = [id, idx];
      if (!isPlainObject(el)) {
        if (c.idCol) row.push(null);
        for (let i = 0; i < c.fields.length; i++) row.push(null);
        row.push(canonicalJson({ $value: el === undefined ? null : el }));
        return row;
      }
      const rest: Record<string, unknown> = {};
      if (c.idCol) {
        row.push(el._id === undefined || el._id === null ? null : idText(el._id));
        if (el._id !== undefined && el._id !== null && !fits("text", el._id)) rest._id = el._id;
      } else if (el._id !== undefined) {
        rest._id = el._id;
      }
      const names = new Set(c.fields.map(([n]) => n));
      for (const [name, type] of c.fields) {
        row.push(convert(type, el[name]));
        if (!fits(type, el[name])) rest[name] = el[name];
      }
      for (const k of Object.keys(el)) {
        if (k !== "_id" && !names.has(k) && el[k] !== undefined) rest[k] = el[k];
      }
      row.push(Object.keys(rest).length ? canonicalJson(rest) : null);
      return row;
    });
  };
}

interface Def {
  collection: string;
  table: string;
  fields: Field[];
  /** 1:1 subdocuments flattened as `${parent}_${field}` columns. */
  flattened?: Record<string, Field[]>;
  children?: ChildDef[];
}

/** Builds a spec: columns in field order, then flattened subdocuments; `known` and `extraFields` derived from them. */
function spec(d: Def): MasterSpec {
  const flat = d.flattened || {};
  const children = d.children || [];
  const columns = [
    ...d.fields.map(([n, t]) => col(n, t)),
    ...Object.entries(flat).flatMap(([parent, fs]) => fs.map(([n, t]) => subCol(parent, n, t))),
  ];
  return {
    collection: d.collection,
    table: d.table,
    columns,
    known: [...d.fields.map(([n]) => n), ...Object.keys(flat), ...children.map((c) => c.field)],
    flattened: Object.keys(flat).length ? Object.fromEntries(Object.entries(flat).map(([p, fs]) => [p, fs.map(([n]) => n)])) : undefined,
    children: children.length
      ? children.map((c) => ({ table: c.table, parentCol: c.parentCol, columns: childColumns(c), rows: childRows(c) }))
      : undefined,
    extraFields: (doc: any) => {
      const out: Record<string, unknown> = {};
      for (const [n, t] of d.fields) if (!fits(t, doc?.[n])) out[n] = doc[n];
      for (const [parent, fs] of Object.entries(flat)) {
        const s = doc?.[parent];
        if (s === null || s === undefined) continue;
        // Not a subdocument, one with its own _id (the engine drops subdocument ids) or with a value its column
        // cannot hold: keep the whole original.
        if (!isPlainObject(s) || s._id !== undefined || fs.some(([n, t]) => !fits(t, s[n]))) out[parent] = s;
      }
      for (const c of children) {
        const v = doc?.[c.field];
        if (v !== null && v !== undefined && !Array.isArray(v)) out[c.field] = v;
      }
      return out;
    },
  };
}

const text = (...names: string[]): Field[] => names.map((n) => [n, "text"]);

export const CRM_DOCS_SPECS: MasterSpec[] = [
  spec({
    collection: "leads",
    table: "leads",
    fields: [
      ...text("leadId", "customerName", "mobile", "email", "source", "walkInReason", "interestedProduct", "vpCode", "assignedStaff"),
      ["estimatedValue", "real"],
      ...text("priority", "status", "followUpDate", "lastFollowUpDate"),
      ["callCount", "int"],
      ["lastCalledAt", "date"],
      ...text("notes", "estimateNumber", "estimateId", "convertedInvoiceNumber"),
      ["items", "json"],
      ["timeline", "json"],
    ],
    children: [
      {
        table: "leadFollowUps",
        field: "followUps",
        parentCol: "leadId",
        fields: [...text("date", "nextDate", "outcome", "notes", "staff", "staffId"), ["loggedAt", "date"]],
      },
      { table: "leadCalls", field: "calls", parentCol: "leadId", fields: [["at", "date"], ...text("staff", "staffId")] },
      {
        table: "leadShares",
        field: "sharedWith",
        parentCol: "leadId",
        fields: [
          ...text("staff", "staffId", "brand", "products", "note", "status", "requestedBy", "requestedById"),
          ["requestedAt", "date"],
          ["respondedAt", "date"],
        ],
      },
    ],
  }),
  spec({
    collection: "walk_in_queries",
    table: "walkInQueries",
    fields: [
      ...text("customerName", "mobile", "date", "time", "reason", "interestedProduct", "category"),
      ["budget", "real"],
      ...text("staff", "notes", "followUpDate", "status", "leadId"),
    ],
  }),
  spec({
    collection: "customer_complaints",
    table: "customerComplaints",
    fields: [
      ...text(
        "ticketNumber", "complaintType", "accusedStaffId", "accusedStaffName", "accusedStaffRole", "accusedStaffBrand",
        "customerName", "customerPhone", "customerEmail", "customerAddress", "productName", "vpCode", "serialNumber",
        "invoiceNumber", "purchaseDate", "issueTitle", "issueDescription", "priority", "status", "assignedTo",
        "assignedStaffRole", "assignedDate", "actionTaken", "resolutionNotes"
      ),
      ["resolvedAt", "date"],
      ...text("resolvedBy", "customerFeedback"),
    ],
  }),
  spec({
    collection: "whatsapp_messages",
    table: "whatsappMessages",
    fields: [
      ...text("event", "audience", "toNumber", "toName", "message", "waLink", "entityType", "entityRef", "entityId", "status", "provider", "providerMessageId", "error"),
      ["attempts", "int"],
      ["sentAt", "date"],
      ...text("sentBy", "triggeredBy"),
    ],
  }),
  spec({
    collection: "whatsapp_settings",
    table: "whatsappSettings",
    fields: [
      ["provider", "text"],
      ["enabled", "bool"],
      ["adminNumbers", "json"],
      ["notifyCustomer", "bool"],
      ["events", "json"],
      ...text("businessName", "updatedBy"),
    ],
    // cloudApi.accessToken is a secret (select:false in the model): copied as it is, never logged.
    flattened: { cloudApi: text("phoneNumberId", "accessToken", "apiVersion", "templateName", "templateLanguage") },
  }),
  spec({
    collection: "stored_documents",
    table: "storedDocuments",
    fields: [
      ...text("docNo", "date", "narration", "fileUrl", "filePublicId", "fileResourceType", "fileFormat", "fileDeliveryType", "fileName", "fileType"),
      ["fileSize", "real"],
      ...text("folderId", "uploadedBy", "uploadedByUserId", "uploadedByRole"),
    ],
  }),
  spec({
    collection: "document_folders",
    table: "documentFolders",
    fields: text("name", "nameKey", "createdBy", "createdByUserId"),
  }),
  spec({
    collection: "onsitego_plans",
    table: "onsitegoPlans",
    fields: [
      ...text("category", "device", "kind", "vpCode"),
      ["minPrice", "real"],
      ["maxPrice", "real"],
      ["planName", "text"],
      ["years", "real"],
      ["price", "real"],
      ...text("sourceDocId", "sourceFileName"),
    ],
  }),
  spec({
    collection: "gstr_reports",
    table: "gstrReports",
    fields: [
      ...text("reportId", "type", "date", "partyName", "gstin"),
      ["amount", "real"],
      ["igst", "real"],
      ["cgst", "real"],
      ["sgst", "real"],
      ["totalTax", "real"],
    ],
  }),
  spec({
    collection: "journal_entries",
    table: "journalEntries",
    fields: [...text("entryNumber", "date", "description", "referenceType", "referenceId"), ["totalDebit", "real"], ["totalCredit", "real"]],
    children: [
      {
        table: "journalEntryLines",
        field: "lines",
        parentCol: "entryId",
        idCol: "lineId",
        fields: [...text("accountId", "accountName"), ["debit", "real"], ["credit", "real"]],
      },
    ],
  }),
  spec({
    collection: "accounts",
    table: "accounts",
    fields: [...text("code", "name", "type", "description"), ["balance", "real"]],
  }),
];
