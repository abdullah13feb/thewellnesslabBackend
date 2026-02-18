import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOrderConfirmationEmail = async (order: any) => {
  const email = order.guestEmail || order.userEmail; // Assuming we have one of these
  if (!email) {
    console.error('No email address found for order confirmation');
    return;
  }

  const itemsHtml = order.items.map((item: any) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product.name}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">x${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">AED ${item.price * item.quantity}</td>
    </tr>
  `).join('');

  const mailOptions = {
    from: `"Radiant Aura Labs" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmation - #${order.id.slice(-6).toUpperCase()}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #ffffff; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; color: #333333; }
          .badge { background-color: #ef4444; color: white; padding: 4px 12px; border-radius: 9999px; font-size: 10px; font-weight: bold; text-transform: uppercase; display: inline-block; margin-bottom: 15px; }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { margin: 0 0 5px 0; font-size: 20px; font-weight: 700; color: #111; }
          .date { color: #888; font-size: 13px; }
          .total-block { background-color: #effcf6; border-radius: 12px; padding: 25px; text-align: center; margin-bottom: 30px; border: 1px solid #dcfce7; }
          .total-label { color: #15803d; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 8px; text-transform: uppercase; }
          .total-amount { color: #15803d; font-size: 32px; font-weight: 700; margin: 0; }
          .section-title { font-size: 11px; font-weight: 700; color: #666; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 15px; margin-top: 30px; }
          .detail-box { background-color: #f9fafb; border-radius: 8px; border: 1px solid #f3f4f6; overflow: hidden; }
          .detail-row { padding: 15px; border-bottom: 1px solid #f3f4f6; }
          .detail-row:last-child { border-bottom: none; }
          .label { font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: block; }
          .value { font-size: 14px; color: #111; font-weight: 500; margin: 0; }
          .highlight { color: #d97706; }
          .item-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 15px 0; border-bottom: 1px solid #f3f4f6; }
          .item-name { font-size: 14px; font-weight: 600; color: #111; margin-bottom: 4px; }
          .item-meta { font-size: 12px; color: #666; }
          .item-price { font-size: 14px; font-weight: 600; color: #111; }
          .btn-container { text-align: center; margin: 30px 0; }
          .btn { background-color: #bc8c5ba3; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; display: inline-block; }
          .warning-box { background-color: #fef9c3; border: 1px solid #fde047; color: #854d0e; padding: 15px; border-radius: 8px; text-align: center; font-size: 13px; margin-bottom: 30px; }
          .footer { background-color: #1a1a1a; color: #666; text-align: center; padding: 20px; font-size: 11px; border-radius: 0 0 8px 8px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">🔔 NEW ORDER</span>
            <h1>Order #${order.id.slice(-6).toUpperCase()}</h1>
            <p class="date">${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>

          <div class="total-block">
            <div class="total-label">ORDER TOTAL</div>
            <h2 class="total-amount">AED ${order.totalPrice.toLocaleString()}</h2>
          </div>

          <div class="section-title">CUSTOMER DETAILS</div>
          <div class="detail-box">
            <div class="detail-row">
              <span class="label">Name</span>
              <p class="value">${order.guestName || 'Guest Customer'}</p>
            </div>
            <div class="detail-row">
              <span class="label">Email</span>
              <p class="value highlight">${order.guestEmail || order.userEmail}</p>
            </div>
            <div class="detail-row">
              <span class="label">Phone</span>
              <p class="value highlight">${order.guestPhone || 'N/A'}</p>
            </div>
          </div>

          <div class="section-title">ORDER ITEMS</div>
          <div style="border-top: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6;">
            ${order.items.map((item: any) => `
              <div class="item-row" style="display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #f3f4f6;">
                <div>
                  <div class="item-name">${item.product.name}</div>
                  <div class="item-meta">Qty: ${item.quantity} × AED ${item.price}</div>
                </div>
                <div class="item-price">AED ${(item.price * item.quantity).toLocaleString()}</div>
              </div>
            `).join('')}
          </div>

          <!-- Summary Breakdown -->
          <div style="margin-top: 15px; text-align: right; font-size: 13px;">
             <p style="margin: 5px 0;">Subtotal: AED ${order.subtotal}</p>
             <p style="margin: 5px 0;">Shipping: AED ${order.shippingCharge}</p>
             ${order.discount > 0 ? `<p style="margin: 5px 0; color: #16a34a;">Discount: -AED ${order.discount}</p>` : ''}
          </div>

          <div class="section-title">SHIPPING ADDRESS</div>
          <div class="detail-box">
            <div class="detail-row">
              <p class="value" style="line-height: 1.6;">
                <strong>${order.guestName || ''}</strong><br>
                ${order.address}<br>
                ${order.city}<br>
                ${order.pincode}
              </p>
            </div>
          </div>

          <div class="btn-container">
            <a href="https://admin.thewellnesslab.ae/orders/${order.id}" class="btn">VIEW IN ADMIN PANEL</a>
          </div>

          <div class="warning-box">
            <strong>⚠️ Action Required</strong><br>
            Contact customer within 24-48 hours to schedule installation.
          </div>

          <div class="footer">
            Radiant Aura Admin Notification
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Order confirmation email sent to:', email);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
  }
};
