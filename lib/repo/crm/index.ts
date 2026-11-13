/**
 * Every read of the CRM, documents and accounting area, as a pair: `mongo` runs the CURRENT query (copied verbatim
 * from its route / helper) and `d1` returns the same thing from D1. Both take the same single argument object; `d1`
 * also takes the D1 database (default: the Worker binding). See lib/repo/crm/INVENTORY.md for where each is used.
 *
 * Nothing calls these yet: the routes still read Mongo. The shadow-read framework (lib/d1/shadow.ts) compares the
 * pairs, then a route switches to `d1` once it matches.
 */
import type { D1DatabaseLike } from "@/lib/d1/types";
import * as leads from "./leads";
import * as crm from "./crm";
import * as wa from "./whatsapp";
import * as docs from "./documents";
import * as acc from "./accounting";

export interface ReadPair {
  mongo: (...args: any[]) => Promise<any>;
  d1: (...args: any[]) => Promise<any>;
}

const pair = <A>(mongo: (a: A) => Promise<any>, d1: (a: A, db?: D1DatabaseLike) => Promise<any>): ReadPair => ({ mongo, d1 });

export const CRM_READS: Record<string, ReadPair> = {
  "leads.list": pair(leads.leadsListMongo, leads.leadsListD1),
  "leads.shareInbox": pair(leads.leadShareInboxMongo, leads.leadShareInboxD1),
  "leads.search": pair(leads.leadSearchMongo, leads.leadSearchD1),
  "leads.staffOverview": pair(leads.leadsOverviewMongo, leads.leadsOverviewD1),
  "walkIn.list": pair(crm.walkInListMongo, crm.walkInListD1),
  "complaints.list": pair(crm.complaintsListMongo, crm.complaintsListD1),
  "whatsapp.outbox": pair(wa.whatsappOutboxMongo, wa.whatsappOutboxD1),
  "whatsapp.settings": pair(wa.whatsappSettingsMongo, wa.whatsappSettingsD1),
  "whatsapp.settingsWithToken": pair(wa.whatsappSettingsWithTokenMongo, wa.whatsappSettingsWithTokenD1),
  "documents.list": pair(docs.documentsListMongo, docs.documentsListD1),
  "documents.byId": pair(docs.documentByIdMongo, docs.documentByIdD1),
  "documents.countInFolder": pair(docs.documentCountInFolderMongo, docs.documentCountInFolderD1),
  "documents.folderCounts": pair(docs.documentFolderCountsMongo, docs.documentFolderCountsD1),
  "documentFolders.list": pair(docs.documentFoldersListMongo, docs.documentFoldersListD1),
  "documentFolders.byNameKey": pair(docs.folderByNameKeyMongo, docs.folderByNameKeyD1),
  "onsitego.plans": pair(docs.onsitegoPlansMongo, docs.onsitegoPlansD1),
  "accounts.list": pair(acc.accountsListMongo, acc.accountsListD1),
  "journal.list": pair(acc.journalListMongo, acc.journalListD1),
};

/** Reads whose result carries a secret (the WhatsApp access token): never log or print their output. */
export const CRM_SECRET_READS = new Set(["whatsapp.settingsWithToken"]);

export * from "./leads";
export * from "./crm";
export * from "./whatsapp";
export * from "./documents";
export * from "./accounting";
