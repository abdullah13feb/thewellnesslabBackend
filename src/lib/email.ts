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

  if (!order.items) {
    console.error('No items found in order for email confirmation');
    return;
  }

  const mailOptions = {
    from: `"Radiant Aura Labs" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmation - #${order.id.slice(-6).toUpperCase()}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #e5e5e5; -webkit-font-smoothing: antialiased; }
          .wrapper { padding: 40px 20px; background-color: #e5e5e5; width: 100%; box-sizing: border-box; }
          .main { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 500px; padding: 40px; box-sizing: border-box; }
          .brand-logo { font-size: 26px; font-weight: 800; color: #111; letter-spacing: -1px; margin-bottom: 30px; text-transform: lowercase; }
          .greeting { font-size: 14px; color: #444; margin: 0 0 8px; }
          .greeting strong { font-size: 18px; color: #111; font-weight: 600; display: block; margin-top: 6px; }
          .divider { border-top: 1px solid #eaeaea; margin: 24px 0; }
          .dotted-divider { border-top: 1px dashed #cccccc; margin: 24px 0; }
          .items-list { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          .item-row td { padding: 8px 0; font-size: 14px; color: #333; }
          .total-paid { font-size: 16px; font-weight: 700; color: #111; margin: 24px 0; }
          .disclaimer { font-size: 10px; color: #888; text-align: center; line-height: 1.5; margin: 30px 0; padding: 0 10px; }
          .footer { text-align: center; font-size: 10px; color: #999; line-height: 1.6; }
          .footer strong { color: #555; }
          @media screen and (max-width: 500px) {
            .wrapper { padding: 0; }
            .main { padding: 30px 20px; border: none; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="main">
            <div class="brand-logo">radiant aura</div>
            
            <div class="greeting">
              Hi ${order.guestName ? order.guestName.split(' ')[0] : 'Customer'},
              <strong>Thank you for ordering from Radiant Aura</strong>
            </div>

            <div class="divider"></div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 15px 0;">
              <tr>
                <td style="font-size: 12px; font-weight: 600; color: #555; text-transform: uppercase;">
                  ORDER ID: ${order.id.slice(-10).toUpperCase()}
                </td>
                <td align="right" style="font-size: 12px; font-weight: 600; color: #219653;">
                  <table cellpadding="0" cellspacing="0" border="0" align="right">
                    <tr>
                      <td style="width:14px; height:14px; background-color:#219653; color:#fff; border-radius:50%; text-align:center; vertical-align:middle; font-size:9px;">✓</td>
                      <td style="padding-left: 5px; color:#219653;">Order Confirmed</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <div class="dotted-divider"></div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
              <tr>
                <td width="55" valign="top">
                  <div style="width: 40px; height: 40px; background-color: #e63946; color: #fff; text-align: center; border-radius: 4px; font-weight: 700; font-size: 14px; letter-spacing: 1px;">
                    <table width="100%" height="100%" cellpadding="0" cellspacing="0">
                      <tr><td align="center" valign="middle">RA</td></tr>
                    </table>
                  </div>
                </td>
                <td valign="middle">
                  <h3 style="margin: 0 0 4px; font-size: 15px; color: #111; font-weight: 600;">Radiant Aura</h3>
                  <p style="margin: 0; font-size: 11px; color: #666; line-height: 1.4;">
                    Dubai, United Arab Emirates<br>
                    <a href="mailto:support@thewellnesslab.ae" style="color: #666; text-decoration: none;">support@thewellnesslab.ae</a>
                  </p>
                </td>
              </tr>
            </table>

            <div class="dotted-divider"></div>

            <table class="items-list" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 5px;">
              ${order.items.map((item: any) => `
                <tr class="item-row">
                  <td width="55" valign="top" style="padding: 12px 12px 12px 0;">
                    ${item.product && item.product.image ? `<img src="${item.product.image}" alt="${item.product.name}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #eaeaea;">` : `<div style="width: 48px; height: 48px; background-color: #f0f0f0; border-radius: 6px; display: inline-block;"></div>`}
                  </td>
                  <td valign="middle" style="padding: 12px 0;">
                    <div style="font-weight: 600; color: #111; font-size: 14px; margin-bottom: 4px; line-height: 1.3;">${item.product ? item.product.name : 'Product'}</div>
                    <div style="color: #666; font-size: 12px;">Qty: ${item.quantity} <span style="margin: 0 4px; color: #ccc;">•</span> AED ${(item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each</div>
                  </td>
                  <td align="right" valign="middle" style="padding: 12px 0; font-weight: 600; color: #111; font-size: 14px;">
                    AED ${(item.price * item.quantity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              `).join('')}
            </table>
            
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 14px; color: #333; margin: 15px 0 5px;">
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px;">Subtotal</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; font-size: 13px;">AED ${(order.subtotal || order.totalPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ${order.shippingCharge > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px;">Shipping Charge</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; font-size: 13px;">AED ${order.shippingCharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ` : ''}
              ${order.discount > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #16a34a; font-size: 13px;">Discount ${order.couponCode ? '(' + order.couponCode + ')' : ''}</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; color: #16a34a; font-size: 13px;">-AED ${order.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ` : ''}
            </table>

            <div class="total-paid">
              Total amount - AED ${(order.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            <div class="disclaimer">
              Radiant Aura employees or representatives will NEVER ask you for your personal information i.e. your bank account details, passwords, PIN, CVV, OTP etc. For your own safety, DO NOT share these details with anyone over phone, SMS or email.
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #6d28d9; color: white; border-radius: 8px; margin-bottom: 30px;">
              <tr>
                <td style="padding: 25px 24px;">
                  <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 800; font-style: italic; text-transform: uppercase;">Discover Wellness</h4>
                  <p style="margin: 0; font-size: 11px; opacity: 0.9;">Explore our latest premium collections.</p>
                </td>
                <td align="right" style="padding: 25px 24px;">
                  <a href="https://thewellnesslab.ae" style="background-color: #fff; color: #6d28d9; padding: 10px 16px; border-radius: 4px; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-block;">SHOP NOW</a>
                </td>
              </tr>
            </table>

            <div class="footer">
              © ${new Date().getFullYear()} - <strong>Radiant Aura</strong>. All rights reserved.<br>
              Radiant Aura LLC<br>
              Dubai, United Arab Emirates
            </div>
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
