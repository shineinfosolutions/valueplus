/**
 * Marking a bill "Out for delivery": the delivery OTP, the driver and the vehicle are saved on the bill (and on its
 * delivery challan, if there is one). Used by the Order Dispatch screen and by the store-exit check, so both send the
 * customer the same OTP and message.
 */
export type OutForDeliveryResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      data: {
        invoiceNumber: string;
        deliveryStatus: "out_for_delivery";
        otp: string;
        driverName: string;
        driverPhone: string;
        vehicleNo: string;
        customerPhone: string;
        customerName: string;
        trackingUrl: string;
      };
    };

export async function markOutForDelivery(
  invoice: any,
  challan: any,
  input: { driverName?: string; driverPhone?: string; vehicleNo?: string; fallbackNumber?: string }
): Promise<OutForDeliveryResult> {
  const { driverName, driverPhone, vehicleNo } = input;
  // Bajaj Finance asks for the vehicle on the delivery; no other bill needs one.
  if (/bajaj/i.test(String(invoice?.financeProvider || "")) && !String(vehicleNo || invoice?.driverVehicleNo || "").trim()) {
    return { ok: false, error: "Vehicle number is compulsory for a Bajaj Finance delivery.", status: 400 };
  }
  const generatedOtp = invoice?.deliveryOtp || challan?.deliveryOtp || Math.floor(1000 + Math.random() * 9000).toString();

  if (invoice) {
    invoice.deliveryStatus = "out_for_delivery";
    invoice.deliveryOtp = generatedOtp;
    if (driverName) invoice.driverName = driverName;
    if (driverPhone) invoice.driverPhone = driverPhone;
    if (vehicleNo) invoice.driverVehicleNo = vehicleNo;
    await invoice.save();
  }
  if (challan) {
    challan.status = "in-transit";
    challan.deliveryOtp = generatedOtp;
    if (driverName) challan.driverName = driverName;
    if (driverPhone) challan.driverPhone = driverPhone;
    if (vehicleNo) challan.vehicleNo = vehicleNo;
    await challan.save();
  }

  const invNo = invoice?.invoiceNumber || challan?.invoiceNumber || input.fallbackNumber || "";
  return {
    ok: true,
    data: {
      invoiceNumber: invNo,
      deliveryStatus: "out_for_delivery",
      otp: generatedOtp,
      driverName: driverName || invoice?.driverName || "Delivery Boy",
      driverPhone: driverPhone || invoice?.driverPhone || "",
      vehicleNo: vehicleNo || invoice?.driverVehicleNo || "",
      customerPhone: invoice?.customerPhone || challan?.customerPhone || "",
      customerName: invoice?.customerName || challan?.destinationParty || "Customer",
      trackingUrl: `/track/${invNo}`,
    },
  };
}
