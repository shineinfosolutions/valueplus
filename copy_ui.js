const fs = require('fs');
const dashboard = fs.readFileSync('app/(dashboard)/dashboard/page.tsx', 'utf-8');
const invoices = fs.readFileSync('app/(dashboard)/sales/invoices/page.tsx', 'utf-8');

const dashStart = dashboard.indexOf('<Dialog open={openInvoiceModal} onOpenChange={setOpenInvoiceModal}>');
const dashEnd = dashboard.indexOf('{/* ─── 2. NEW ESTIMATE MODAL FORM ─────────────────────────────── */}');
let dashModal = dashboard.substring(dashStart, dashEnd);

// Extract just the DialogContent
const contentStart = dashModal.indexOf('<DialogContent');
const contentEnd = dashModal.lastIndexOf('</DialogContent>') + '</DialogContent>'.length;
let content = dashModal.substring(contentStart, contentEnd);

// Map the variables
content = content.replace(/invoiceForm/g, 'billingForm');
content = content.replace(/setInvoiceForm/g, 'setBillingForm');
content = content.replace(/invoiceCalculations/g, 'billCalculations');
content = content.replace(/addInvoiceRow/g, 'addLineItem');
content = content.replace(/updateInvoiceRow/g, 'handleLineItemChange');
content = content.replace(/removeInvoiceRow/g, 'removeLineItem');
content = content.replace(/handleCreateInvoice/g, 'handleGenerateInvoice');
content = content.replace(/setOpenInvoiceModal\(false\)/g, 'setIsBillingFormOpen(false)');

// Fix item properties
content = content.replace(/billingForm\.items/g, 'billingForm.lineItems');
content = content.replace(/item\.itemName/g, 'item.name');
content = content.replace(/item\.quantity/g, 'item.qty');
content = content.replace(/handleLineItemChange\(idx, \"itemName\"/g, 'handleLineItemChange(idx, \"name\")');
content = content.replace(/handleLineItemChange\(idx, \"quantity\"/g, 'handleLineItemChange(idx, \"qty\")');
content = content.replace(/submitting/g, 'isSubmitting');

// Replace in invoices file
// We need to find the <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto p-0 bg-slate-50/50"> in invoices
const invStartRegex = /<DialogContent className=\"[^\"]*max-w-6xl[^\"]*\">/;
const invStartMatch = invoices.match(invStartRegex);

if (invStartMatch) {
  const invStart = invStartMatch.index;
  // find the corresponding closing tag for this DialogContent
  const invEnd = invoices.indexOf('</DialogContent>', invStart) + '</DialogContent>'.length;
  
  const newInvoices = invoices.substring(0, invStart) + content + invoices.substring(invEnd);
  fs.writeFileSync('app/(dashboard)/sales/invoices/page.tsx', newInvoices);
  console.log('Successfully replaced DialogContent!');
} else {
  // Let's try finding the Dialog wrapper
  const dialogStartStr = '<Dialog open={isBillingFormOpen} onOpenChange={setIsBillingFormOpen}>';
  const dialogStart = invoices.indexOf(dialogStartStr);
  if(dialogStart !== -1) {
      const dContentStart = invoices.indexOf('<DialogContent', dialogStart);
      const dContentEnd = invoices.indexOf('</DialogContent>', dContentStart) + '</DialogContent>'.length;
      const newInvoices = invoices.substring(0, dContentStart) + content + invoices.substring(dContentEnd);
      fs.writeFileSync('app/(dashboard)/sales/invoices/page.tsx', newInvoices);
      console.log('Successfully replaced DialogContent via wrapper!');
  } else {
      console.log('Could not find DialogContent in invoices page.');
  }
}
