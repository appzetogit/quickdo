export const printZomatoInvoice = (order, companyName, termsHtml = "") => {
  const printWindow = window.open("", "_blank")
  if (!printWindow) {
    alert("Please allow popups for this site")
    return
  }

  // Helper to safely format currency
  const formatCurrency = (val) => {
    const num = Number(val)
    if (isNaN(num)) return "₹0.00"
    return `₹${num.toFixed(2)}`
  }

  // Format date correctly
  const formatDate = (dateString) => {
    if (!dateString) return ""
    const d = new Date(dateString)
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  }

  // Map database details correctly
  const p = order.pricing || {}
  const subtotal = p.subtotal !== undefined ? p.subtotal : (order.subtotal || 0)
  const deliveryFee = p.deliveryFee !== undefined ? p.deliveryFee : (order.deliveryFee || 0)
  const tax = p.tax !== undefined ? p.tax : (order.tax || 0)
  const discount = p.discount !== undefined ? p.discount : (order.discount || 0)
  const total = p.total !== undefined ? p.total : (order.total || 0)
  const packagingCharge = p.packagingFee !== undefined ? p.packagingFee : (order.packagingCharge || 0)
  const platformFee = p.platformFee !== undefined ? p.platformFee : (order.platformFee || 0)

  const customerName = order.userId?.fullName || order.userId?.name || order.customer?.name || order.user?.name || order.customerName || "Customer"
  const customerPhone = order.userId?.phone || order.customer?.phone || order.user?.phone || order.customerPhone || "N/A"

  const addr = order.deliveryAddress || order.address || {}
  const customerAddress = typeof addr === 'string' ? addr : (
    addr.formattedAddress ||
    [addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean).join(", ") ||
    "N/A"
  )

  const restaurantName = order.restaurantId?.restaurantName || order.restaurantName || order.restaurant?.name || companyName || "Restaurant"
  const restLoc = order.restaurantId?.location || order.restaurant?.location || {}
  const restaurantAddress = order.restaurantId?.address || order.restaurant?.address || 
    restLoc.formattedAddress || restLoc.address || "N/A"

  const deliveryPartnerName = order.deliveryPartner?.name || order.dispatch?.deliveryPartnerId?.name || "Assigning..."

  const items = (order.items || []).map(item => ({
    name: item.name || "Item",
    quantity: item.quantity || item.qty || 1,
    price: item.price || 0,
    variantName: item.variantName || ""
  }))

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Quick Drop Food Order: Summary and Receipt</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 20px;
          font-size: 12px;
          line-height: 1.5;
        }
        .header {
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 8px 16px;
          margin-bottom: 30px;
        }
        .summary-grid div {
          word-wrap: break-word;
        }
        .summary-label {
          font-weight: bold;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        thead th {
          background-color: #f1f1f1;
          text-align: left;
          padding: 8px;
          font-weight: bold;
          border-bottom: 1px solid #ccc;
        }
        tbody td {
          padding: 8px;
          border-bottom: 1px dashed #eee;
        }
        .text-right {
          text-align: right !important;
        }
        .text-center {
          text-align: center !important;
        }
        .totals-section {
          width: 50%;
          margin-left: auto;
          margin-bottom: 40px;
        }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
        }
        .totals-row.grand-total {
          font-weight: bold;
          border-top: 1px solid #000;
          border-bottom: 1px solid #000;
          padding: 8px 0;
          margin-top: 4px;
        }
        .terms-section {
          font-size: 10px;
          color: #555;
          margin-top: 40px;
          border-top: 1px solid #ccc;
          padding-top: 20px;
        }
        .terms-section h4 {
          margin: 0 0 10px 0;
          font-size: 11px;
          color: #333;
        }
        @media print {
          body {
            padding: 0;
            margin: 0;
            -webkit-print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        Quick Drop Food Order: Summary and Receipt
      </div>

      <div class="summary-grid">
        <div class="summary-label">Order ID</div>
        <div>${order.id || order.orderId || order._id || "N/A"}</div>

        <div class="summary-label">Order Time</div>
        <div>${formatDate(order.createdAt)}</div>

        <div class="summary-label">Customer Name</div>
        <div>${customerName} (${customerPhone})</div>

        <div class="summary-label">Delivery Address</div>
        <div>${customerAddress}</div>

        <div class="summary-label">Restaurant Name</div>
        <div>${restaurantName}</div>

        <div class="summary-label">Restaurant Address</div>
        <div>${restaurantAddress}</div>

        <div class="summary-label">Delivery partner's name</div>
        <div>${deliveryPartnerName}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Items</th>
            <th class="text-center">Quantity</th>
            <th class="text-right">Unit Price</th>
            <th class="text-right">Total Price</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
            <tr>
              <td>${item.name} ${item.variantName ? `<br><small>(${item.variantName})</small>` : ""}</td>
              <td class="text-center">${item.quantity}</td>
              <td class="text-right">${formatCurrency(item.price)}</td>
              <td class="text-right">${formatCurrency(item.price * item.quantity)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="totals-section">
        <div class="totals-row">
          <span>Subtotal</span>
          <span>${formatCurrency(subtotal)}</span>
        </div>
        <div class="totals-row">
          <span>Taxes</span>
          <span>${formatCurrency(tax)}</span>
        </div>
        <div class="totals-row">
          <span>Delivery charge subtotal</span>
          <span>${formatCurrency(deliveryFee)}</span>
        </div>
        ${
          packagingCharge > 0
            ? `
        <div class="totals-row">
          <span>Restaurant Packaging Charges</span>
          <span>${formatCurrency(packagingCharge)}</span>
        </div>`
            : ""
        }
        ${
          platformFee > 0
            ? `
        <div class="totals-row">
          <span>Platform fee</span>
          <span>${formatCurrency(platformFee)}</span>
        </div>`
            : ""
        }
        ${
          discount > 0
            ? `
        <div class="totals-row">
          <span>Coupon / Discount</span>
          <span>-${formatCurrency(discount)}</span>
        </div>`
            : ""
        }
        <div class="totals-row grand-total">
          <span>Total</span>
          <span>${formatCurrency(total)}</span>
        </div>
      </div>

      <div class="terms-section">
        <h4>Terms & Conditions</h4>
        ${termsHtml || "<p>Standard terms and conditions apply.</p>"}
      </div>
    </body>
    </html>
  `

  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  
  // Need a small timeout to ensure images/styles load before printing
  setTimeout(() => {
    printWindow.print()
  }, 500)
}
